//! Client for the Orax Remote registry (`cloudflare/`), speaking the `/v1` API.
//!
//! The identity is the same ed25519 key iroh already uses, so a device is the
//! endpoint id it already has: nothing new is enrolled and no second secret is
//! stored. Requests are signed over a domain-separated canonical string; the
//! signature proves possession, and the id can never be enough on its own.
//!
//! Nothing in this crate touches session media. It carries an opaque
//! `boundary1:` invitation, which the Worker only ever stores sealed.

#![forbid(unsafe_code)]

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use iroh::SecretKey;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Method, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub mod directory;
pub mod keys;

pub use keys::RegistryKey;

/// The two keys a device has, and what each of them is for.
///
/// The IDENTITY is the device's name in the peer-to-peer world. It is the
/// device's address, it is what a paired helper is recognised by, and it
/// never changes. The REGISTRY key signs the HTTP calls to this service and
/// nothing else.
///
/// They are separate because their blast radii are different: the identity is
/// trusted by every machine the device has ever paired with, and the registry
/// key only by this one service. A device that signs its API calls with its
/// identity hands a leaked identity key to whoever can then take the wheel on
/// every machine that trusts it.
#[derive(Clone)]
pub struct DeviceKeys {
    /// The peer-to-peer identity. The device's id is this key's hex.
    pub identity: SecretKey,
    /// What signs the calls to the registry.
    pub registry: SecretKey,
}

impl DeviceKeys {
    pub fn new(identity: SecretKey, registry: SecretKey) -> Self {
        Self { identity, registry }
    }
}

/// Domain separation: the device key also signs iroh handshakes, so an API
/// signature must never be reusable as one (or vice versa).
const AUTH_PREFIX: &str = "orax-device-auth-v2";
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

/// The whole request, connect included.
///
/// The Worker answers in milliseconds, so almost all of this budget is the
/// network and the TLS handshake. Ten seconds was tight enough to fail the
/// FIRST call in a process on a cold edge or a slow link, and the failure
/// looked like "the registry could not be reached" when the truth was "the
/// handshake was slow". A first call that a second call would have made is
/// the worst kind of failure to explain, so the budget is generous and the
/// CONNECT is what is held short.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// How long the connection itself may take.
///
/// A connection that has not been established in this long is not going to
/// be, and a user staring at a spinner is better served by a clear failure
/// than by a request that ends in the same place later.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("enter an HTTPS registry URL (plain http is only allowed for loopback)")]
    Url,
    #[error("the registry could not be reached: {0}")]
    Http(#[from] reqwest::Error),
    #[error("the registry could not be reached: {0}")]
    Client(String),
    #[error("the registry key could not be stored: {0}")]
    Keychain(String),
    #[error("the registry returned {status} {code}: {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
    },
    #[error("the registry returned an unexpected response: {0}")]
    Decode(String),
    #[error("cannot generate a request nonce")]
    Nonce,
    #[error("the registry sent more than 64 KiB")]
    TooLarge,
}

/// The public device record. It carries no address, label or secret.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeviceRecord {
    pub id: String,
    pub fingerprint: String,
    /// The nine-digit number shown on the device, once it has registered.
    #[serde(default)]
    pub number: Option<String>,
    pub protocol_version: u8,
    pub client_version: Option<String>,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
}

/// A short-lived code plus the token that can revoke it before it is used.
///
/// `revoke_token` is only present on the first response: a retried create
/// returns the same code, and the Worker never keeps the token in the clear, so
/// it cannot be shown again.
#[derive(Clone, Deserialize, Serialize)]
pub struct SignalCode {
    pub code: String,
    pub expires_at: i64,
    #[serde(default)]
    pub revoke_token: Option<String>,
}

/// What the registry says about itself.
///
/// The database and the sealing key are reported separately, because a
/// registry that is up but has no key is a different problem from one whose
/// database is unreachable, and a person told "codes are not available" can
/// act on one and not the other.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Health {
    pub status: String,
    pub api: String,
    #[serde(default)]
    pub db: Option<String>,
    #[serde(default)]
    pub invitation_key: Option<String>,
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Deserialize)]
struct ErrorBody {
    code: String,
    message: String,
}

/// The canonical string both sides sign. Kept public so the wire format has a
/// test vector rather than living only in prose.
///
/// The ORIGIN is part of what is signed. Without it, a signature captured at
/// one registry verifies at any other registry for the same method and path,
/// so a device pointed at one registry could have its request replayed at
/// another, and an invitation meant for one registry could be read by
/// another. The Worker derives the origin from the request it received, so
/// the two sides cannot disagree about which registry this is.
pub fn canonical_string(
    origin: &str,
    method: &str,
    path: &str,
    body_sha256_hex: &str,
    timestamp: i64,
    nonce: &str,
) -> String {
    let method = method.to_ascii_uppercase();
    let timestamp = timestamp.to_string();
    [
        AUTH_PREFIX,
        origin,
        method.as_str(),
        path,
        body_sha256_hex,
        timestamp.as_str(),
        nonce,
    ]
    .join("\n")
}

/// The nine-digit number the registry shows for a device, derived the same way
/// the Worker derives it (SHA-256 of the raw 32-byte public key).
pub fn device_number(key: &SecretKey) -> String {
    let digest = Sha256::digest(key.public().as_bytes());
    let value = ((digest[0] as u32) << 24)
        | ((digest[1] as u32) << 16)
        | ((digest[2] as u32) << 8)
        | (digest[3] as u32);
    format!("{:09}", value % 1_000_000_000)
}

/// The id the registry stores: iroh's `EndpointId` display form, which is the
/// lower-case hex of the 32-byte ed25519 public key.
pub fn device_id(key: &SecretKey) -> String {
    key.public().to_string()
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

fn nonce() -> Result<String, Error> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| Error::Nonce)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn base_url(value: &str) -> Result<Url, Error> {
    let mut url = Url::parse(value.trim()).map_err(|_| Error::Url)?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "localhost"));
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err(Error::Url);
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Url);
    }
    if url.path() != "/" {
        return Err(Error::Url);
    }
    url.set_path("");
    Ok(url)
}

/// One HTTP client for the whole process.
///
/// A client per request means a new connection pool, a new TLS configuration
/// and a fresh TLS handshake every time, and the handshake is the most
/// expensive part of talking to the registry. It also means the socket is
/// closed the moment the command returns, so nothing is ever reused. The
/// client is shared, and the per-URL rules (HTTPS, no credentials, no path)
/// are checked separately.
fn shared_http() -> Result<&'static reqwest::Client, Error> {
    static CLIENT: std::sync::OnceLock<Result<reqwest::Client, String>> =
        std::sync::OnceLock::new();
    let slot = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .https_only(false)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .map_err(|error| error.to_string())
    });
    match slot {
        Ok(client) => Ok(client),
        Err(message) => Err(Error::Client(message.clone())),
    }
}

/// A registry endpoint. Cheap to clone; the HTTP client is shared.
#[derive(Clone)]
pub struct Client {
    base: Url,
    /// `scheme://host[:port]`, the same shape the Worker derives from the
    /// request it received. The default port is left out on both sides.
    origin: String,
    http: reqwest::Client,
}

impl Client {
    pub fn new(base: &str) -> Result<Self, Error> {
        let base = base_url(base)?;
        let origin = base.origin().ascii_serialization();
        Ok(Self {
            base,
            origin,
            http: shared_http()?.clone(),
        })
    }

    fn url(&self, path: &str) -> Url {
        let mut url = self.base.clone();
        url.set_path(path);
        url
    }

    /// The body of a response, read with the size cap applied while the
    /// bytes are arriving.
    ///
    /// The cap used to be checked after the whole body had been buffered,
    /// which is no cap at all: the registry URL comes from the webview, so
    /// any host named there could stream as much as it liked into the
    /// process's memory before the size was noticed.
    async fn read_body(mut response: reqwest::Response) -> Result<Vec<u8>, Error> {
        if let Some(length) = response.content_length() {
            if length > MAX_RESPONSE_BYTES as u64 {
                return Err(Error::TooLarge);
            }
        }
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(Error::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    async fn call(
        &self,
        method: Method,
        path: &str,
        keys: Option<(&SecretKey, &SecretKey)>,
        body: Option<Value>,
    ) -> Result<Value, Error> {
        let (status, bytes) = self.call_raw(method, path, keys, body).await?;
        if status.is_success() {
            if bytes.is_empty() {
                return Ok(Value::Null);
            }
            return serde_json::from_slice(&bytes)
                .map_err(|error| Error::Decode(error.to_string()));
        }
        let parsed: ErrorEnvelope =
            serde_json::from_slice(&bytes).map_err(|error| Error::Decode(error.to_string()))?;
        Err(Error::Api {
            status: status.as_u16(),
            code: parsed.error.code,
            message: parsed.error.message,
        })
    }

    /// A request, with the status and the raw body handed back.
    ///
    /// `keys` is the key that SIGNS and the key the device is NAMED by.
    /// They are the same for a registration, and different for everything
    /// else: the registration is the device introducing itself, so it signs
    /// with the identity the Worker can already derive from the body, and it
    /// OFFERS a registry key in the same body. Every call after that is
    /// signed with the registry key, which is the one the Worker will check.
    async fn call_raw(
        &self,
        method: Method,
        path: &str,
        keys: Option<(&SecretKey, &SecretKey)>,
        body: Option<Value>,
    ) -> Result<(reqwest::StatusCode, Vec<u8>), Error> {
        let mut request = self.http.request(method.clone(), self.url(path));
        if body.is_some() {
            request = request.json(&body);
        }
        if let Some((signing_key, identity)) = keys {
            let body_bytes = match &body {
                Some(value) => {
                    serde_json::to_vec(value).map_err(|error| Error::Decode(error.to_string()))?
                }
                None => Vec::new(),
            };
            let body_hash = hex::encode(Sha256::digest(&body_bytes));
            let timestamp = now_seconds();
            let nonce = nonce()?;
            let canonical = canonical_string(
                &self.origin,
                method.as_str(),
                path,
                &body_hash,
                timestamp,
                &nonce,
            );
            let signature = signing_key.sign(canonical.as_bytes());
            let mut headers = HeaderMap::new();
            let id = device_id(identity);
            headers.insert(
                "x-orax-device",
                HeaderValue::from_str(&id).map_err(|_| Error::Decode("device id".into()))?,
            );
            headers.insert(
                "x-orax-timestamp",
                HeaderValue::from_str(&timestamp.to_string())
                    .map_err(|_| Error::Decode("timestamp".into()))?,
            );
            headers.insert(
                "x-orax-nonce",
                HeaderValue::from_str(&nonce).map_err(|_| Error::Decode("nonce".into()))?,
            );
            headers.insert(
                "x-orax-signature",
                HeaderValue::from_str(&URL_SAFE_NO_PAD.encode(signature.to_bytes()))
                    .map_err(|_| Error::Decode("signature".into()))?,
            );
            request = request.headers(headers);
        }

        let response = request.send().await?;
        let status = response.status();
        let bytes = Self::read_body(response).await?;
        Ok((status, bytes))
    }

    /// Registers this device, or refreshes an existing registration.
    ///
    /// The body carries BOTH public keys: the identity, which is the device's
    /// id, and the registry key, which is what the signature is checked
    /// against. A registry that has no registry key for a device falls back to
    /// the identity, so a device that has not been updated keeps working.
    ///
    /// And the other way round: a registry that has not been updated REFUSES
    /// the field it does not know, so the registration is retried without it.
    /// The two registries are not deployed together, and a device must not
    /// care which one it is talking to.
    pub async fn register(
        &self,
        keys: &DeviceKeys,
        label: Option<&str>,
        client_version: &str,
    ) -> Result<DeviceRecord, Error> {
        let mut body = json!({
            "public_key": URL_SAFE_NO_PAD.encode(keys.identity.public().as_bytes()),
            "registry_key": URL_SAFE_NO_PAD.encode(keys.registry.public().as_bytes()),
            "client_version": client_version,
            "protocol_version": 1,
        });
        if let Some(label) = label {
            body["label"] = json!(label);
        }
        let outcome = self
            .call(
                Method::POST,
                "/v1/devices",
                // The registration is the device introducing itself, so it
                // signs with the IDENTITY the Worker can already derive from
                // the body, and it offers the registry key in the same body.
                // Signing it with the registry key would be a chicken and an
                // egg: the Worker only learns that key from this request.
                Some((&keys.identity, &keys.identity)),
                Some(body.clone()),
            )
            .await;
        let value = match outcome {
            Ok(value) => value,
            // A registry that does not know the field refuses the whole
            // body. Registration is idempotent, so trying again without it
            // costs one request and changes nothing else.
            Err(Error::Api { status: 400, .. }) => {
                let mut without = body;
                without
                    .as_object_mut()
                    .map(|object| object.remove("registry_key"));
                self.call(
                    Method::POST,
                    "/v1/devices",
                    Some((&keys.identity, &keys.identity)),
                    Some(without),
                )
                .await?
            }
            Err(error) => return Err(error),
        };
        serde_json::from_value(value).map_err(|error| Error::Decode(error.to_string()))
    }

    /// The public record for a device id.
    /// A GET, with one retry.
    ///
    /// A read that fails in TRANSIT has changed nothing, so asking again is
    /// free and cannot double a side effect. It matters on the first call in
    /// a process, where the connection is cold and the TLS handshake is the
    /// slowest part of the request: without the retry, a slow handshake reads
    /// as "the registry is down", and the user is told the registry is
    /// unreachable when the next call would have worked.
    ///
    /// Only a transport failure is retried. A 404 is an answer, and a 500 is
    /// an answer too; asking again would only make the failure slower.
    async fn call_get(&self, path: &str) -> Result<Value, Error> {
        match self.call(Method::GET, path, None, None).await {
            Ok(value) => Ok(value),
            Err(Error::Http(error)) if error.is_timeout() || error.is_connect() => {
                self.call(Method::GET, path, None, None).await
            }
            Err(error) => Err(error),
        }
    }

    pub async fn lookup(&self, id: &str) -> Result<DeviceRecord, Error> {
        let value = self.call_get(&format!("/v1/devices/{id}")).await?;
        serde_json::from_value(value).map_err(|error| Error::Decode(error.to_string()))
    }

    /// The public record for the nine-digit number shown on a device. Spaces are
    /// ignored, so a number read aloud as groups works as typed.
    pub async fn lookup_by_number(&self, number: &str) -> Result<DeviceRecord, Error> {
        let digits: String = number.chars().filter(char::is_ascii_digit).collect();
        let value = self
            .call_get(&format!("/v1/devices/by-number/{digits}"))
            .await?;
        serde_json::from_value(value).map_err(|error| Error::Decode(error.to_string()))
    }

    /// Revokes this device. Pending codes are dropped by the Worker.
    pub async fn revoke(&self, keys: &DeviceKeys) -> Result<(), Error> {
        let id = device_id(&keys.identity);
        self.call(
            Method::POST,
            &format!("/v1/devices/{id}/revoke"),
            Some((&keys.registry, &keys.identity)),
            Some(json!({})),
        )
        .await?;
        Ok(())
    }

    /// Publishes a `boundary1:` invitation under a short numeric code.
    pub async fn create_signal(
        &self,
        keys: &DeviceKeys,
        invitation: &str,
        ttl_seconds: u32,
    ) -> Result<SignalCode, Error> {
        let value = self
            .call(
                Method::POST,
                "/v1/signals",
                Some((&keys.registry, &keys.identity)),
                Some(json!({ "invitation": invitation, "ttl_seconds": ttl_seconds })),
            )
            .await?;
        serde_json::from_value(value).map_err(|error| Error::Decode(error.to_string()))
    }

    /// Publishes this device's address, so a helper can find it by its id.
    ///
    /// This is ADDRESS data, never session data: where the machine can be
    /// reached. The transport is still iroh's QUIC, the handshake still
    /// authenticates the peer by its key, and nothing about who may connect
    /// is decided here.
    ///
    /// Signed by the registry key, so a third party cannot point a helper at
    /// a machine of their choosing.
    pub async fn publish_address(
        &self,
        keys: &DeviceKeys,
        address: &iroh::EndpointAddr,
    ) -> Result<(), Error> {
        let id = device_id(&keys.identity);
        self.call(
            Method::POST,
            &format!("/v1/devices/{id}/address"),
            Some((&keys.registry, &keys.identity)),
            Some(json!({ "address": address })),
        )
        .await?;
        Ok(())
    }

    /// The address a device published, if it published one.
    ///
    /// Public, like the address directory iroh already uses, and for the same
    /// reason: the address is a place to knock, and the handshake is what
    /// decides whether the knock is answered.
    pub async fn lookup_address(&self, id: &str) -> Result<Option<iroh::EndpointAddr>, Error> {
        let value = self.call_get(&format!("/v1/devices/{id}/address")).await;
        match value {
            Ok(value) => serde_json::from_value(value)
                .map(Some)
                .map_err(|error| Error::Decode(error.to_string())),
            // A device that has not published is not an error: it is the
            // ordinary answer for a machine the directory has never heard of.
            Err(Error::Api { status: 404, .. }) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Consumes a code. The code is the capability; no account is involved.
    pub async fn resolve_signal(&self, code: &str) -> Result<String, Error> {
        let value = self
            .call(
                Method::POST,
                "/v1/signals/resolve",
                None,
                Some(json!({ "code": code })),
            )
            .await?;
        let invitation = value
            .get("invitation")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::Decode("the invitation was not in the response".into()))?;
        Ok(invitation.to_owned())
    }

    /// Revokes a code before it is resolved.
    pub async fn revoke_signal(&self, revoke_token: &str) -> Result<(), Error> {
        self.call(
            Method::POST,
            "/v1/signals/revoke",
            None,
            Some(json!({ "revoke_token": revoke_token })),
        )
        .await?;
        Ok(())
    }

    /// Whether the deployed registry can reach its database.
    ///
    /// A registry whose database is down, or whose sealing key is missing,
    /// answers with `503` and a body that says which of the two it is. That
    /// answer is the whole point of the call, so it is read rather than
    /// thrown away as an error: the caller can then say "the registry's
    /// database is unreachable" instead of "the registry returned an
    /// unexpected response".
    pub async fn health(&self) -> Result<Health, Error> {
        // The health check is the first thing the app does when it opens the
        // registry panel, so it is the call most likely to pay for a cold
        // connection. It is a read, so a second try is free.
        let (status, bytes) = match self.call_raw(Method::GET, "/healthz", None, None).await {
            Ok(outcome) => outcome,
            Err(Error::Http(error)) if error.is_timeout() || error.is_connect() => {
                self.call_raw(Method::GET, "/healthz", None, None).await?
            }
            Err(error) => return Err(error),
        };
        let parsed: Health =
            serde_json::from_slice(&bytes).map_err(|error| Error::Decode(error.to_string()))?;
        if status.is_success() {
            return Ok(parsed);
        }
        if status.as_u16() == 503 {
            // A degraded registry is a real answer, not a failure to answer.
            return Ok(parsed);
        }
        let envelope: ErrorEnvelope =
            serde_json::from_slice(&bytes).map_err(|error| Error::Decode(error.to_string()))?;
        Err(Error::Api {
            status: status.as_u16(),
            code: envelope.error.code,
            message: envelope.error.message,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> SecretKey {
        SecretKey::from_bytes(&[7u8; 32])
    }

    #[test]
    fn canonical_string_matches_the_worker_vector() {
        assert_eq!(
            canonical_string(
                "https://registry.example.com",
                "POST",
                "/v1/signals",
                "abc123",
                1_700_000_000,
                "nonce"
            ),
            "orax-device-auth-v2\nhttps://registry.example.com\nPOST\n/v1/signals\nabc123\n1700000000\nnonce"
        );
    }

    #[test]
    fn method_is_normalised_to_upper_case() {
        assert_eq!(
            canonical_string("https://r.example", "post", "/v1/signals", "abc", 1, "n"),
            canonical_string("https://r.example", "POST", "/v1/signals", "abc", 1, "n")
        );
    }

    #[test]
    fn the_origin_is_part_of_what_is_signed() {
        // A signature made for one registry must not verify at another.
        assert_ne!(
            canonical_string("https://a.example", "POST", "/v1/signals", "abc", 1, "n"),
            canonical_string("https://b.example", "POST", "/v1/signals", "abc", 1, "n")
        );
    }

    #[test]
    fn device_id_is_64_lower_case_hex_and_matches_the_key() {
        let id = device_id(&key());
        assert_eq!(id.len(), 64, "endpoint id is hex of 32 bytes");
        assert!(id
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(id, key().public().to_string());
    }

    #[test]
    fn nonces_are_22_characters_of_url_safe_base64() {
        let value = nonce().expect("nonce");
        assert_eq!(value.len(), 22);
        assert!(value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(value, nonce().expect("nonce"));
    }

    #[test]
    fn urls_must_be_https_without_credentials_or_extras() {
        for bad in [
            "http://registry.example.com",
            "https://user:pass@registry.example.com",
            "https://registry.example.com/path",
            "https://registry.example.com?token=1",
            "https://registry.example.com#frag",
            "not a url",
        ] {
            assert!(Client::new(bad).is_err(), "{bad} should be refused");
        }
        assert!(Client::new("https://registry.example.com").is_ok());
        assert!(Client::new("https://registry.example.com/").is_ok());
        assert!(Client::new("http://127.0.0.1:8787").is_ok());
        assert!(Client::new("http://localhost:8787").is_ok());
    }
}
