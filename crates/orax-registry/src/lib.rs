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

/// Domain separation: the device key also signs iroh handshakes, so an API
/// signature must never be reusable as one (or vice versa).
const AUTH_PREFIX: &str = "orax-device-auth-v1";
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("enter an HTTPS registry URL (plain http is only allowed for loopback)")]
    Url,
    #[error("registry request failed")]
    Http(#[from] reqwest::Error),
    #[error("registry returned {status} {code}: {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
    },
    #[error("registry returned an unexpected response")]
    Decode,
    #[error("cannot generate a request nonce")]
    Nonce,
}

/// The public device record. It carries no address, label or secret.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeviceRecord {
    pub id: String,
    pub fingerprint: String,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Health {
    pub status: String,
    pub api: String,
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
pub fn canonical_string(
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
        method.as_str(),
        path,
        body_sha256_hex,
        timestamp.as_str(),
        nonce,
    ]
    .join("\n")
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

/// A registry endpoint. Cheap to clone; the HTTP client is shared.
#[derive(Clone)]
pub struct Client {
    base: Url,
    http: reqwest::Client,
}

impl Client {
    pub fn new(base: &str) -> Result<Self, Error> {
        let base = base_url(base)?;
        let http = reqwest::Client::builder()
            .https_only(false)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .build()?;
        Ok(Self { base, http })
    }

    fn url(&self, path: &str) -> Url {
        let mut url = self.base.clone();
        url.set_path(path);
        url
    }

    async fn call(
        &self,
        method: Method,
        path: &str,
        key: Option<&SecretKey>,
        body: Option<Value>,
    ) -> Result<Value, Error> {
        let mut request = self.http.request(method.clone(), self.url(path));
        if body.is_some() {
            request = request.json(&body);
        }
        if let Some(key) = key {
            let body_bytes = match &body {
                Some(value) => serde_json::to_vec(value).map_err(|_| Error::Decode)?,
                None => Vec::new(),
            };
            let body_hash = hex::encode(Sha256::digest(&body_bytes));
            let timestamp = now_seconds();
            let nonce = nonce()?;
            let canonical = canonical_string(method.as_str(), path, &body_hash, timestamp, &nonce);
            let signature = key.sign(canonical.as_bytes());
            let mut headers = HeaderMap::new();
            let id = device_id(key);
            headers.insert(
                "x-orax-device",
                HeaderValue::from_str(&id).map_err(|_| Error::Decode)?,
            );
            headers.insert(
                "x-orax-timestamp",
                HeaderValue::from_str(&timestamp.to_string()).map_err(|_| Error::Decode)?,
            );
            headers.insert(
                "x-orax-nonce",
                HeaderValue::from_str(&nonce).map_err(|_| Error::Decode)?,
            );
            headers.insert(
                "x-orax-signature",
                HeaderValue::from_str(&URL_SAFE_NO_PAD.encode(signature.to_bytes()))
                    .map_err(|_| Error::Decode)?,
            );
            request = request.headers(headers);
        }

        let response = request.send().await?;
        let status = response.status();
        let bytes = response.bytes().await?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err(Error::Decode);
        }
        if status.is_success() {
            if bytes.is_empty() {
                return Ok(Value::Null);
            }
            return serde_json::from_slice(&bytes).map_err(|_| Error::Decode);
        }
        let parsed: ErrorEnvelope = serde_json::from_slice(&bytes).map_err(|_| Error::Decode)?;
        Err(Error::Api {
            status: status.as_u16(),
            code: parsed.error.code,
            message: parsed.error.message,
        })
    }

    /// Registers this device, or refreshes an existing registration.
    pub async fn register(
        &self,
        key: &SecretKey,
        label: Option<&str>,
        client_version: &str,
    ) -> Result<DeviceRecord, Error> {
        let mut body = json!({
            "public_key": URL_SAFE_NO_PAD.encode(key.public().as_bytes()),
            "client_version": client_version,
            "protocol_version": 1,
        });
        if let Some(label) = label {
            body["label"] = json!(label);
        }
        let value = self
            .call(Method::POST, "/v1/devices", Some(key), Some(body))
            .await?;
        serde_json::from_value(value).map_err(|_| Error::Decode)
    }

    /// The public record for a device id.
    pub async fn lookup(&self, id: &str) -> Result<DeviceRecord, Error> {
        let value = self
            .call(Method::GET, &format!("/v1/devices/{id}"), None, None)
            .await?;
        serde_json::from_value(value).map_err(|_| Error::Decode)
    }

    /// Revokes this device. Pending codes are dropped by the Worker.
    pub async fn revoke(&self, key: &SecretKey) -> Result<(), Error> {
        let id = device_id(key);
        self.call(
            Method::POST,
            &format!("/v1/devices/{id}/revoke"),
            Some(key),
            Some(json!({})),
        )
        .await?;
        Ok(())
    }

    /// Publishes a `boundary1:` invitation under a short numeric code.
    pub async fn create_signal(
        &self,
        key: &SecretKey,
        invitation: &str,
        ttl_seconds: u32,
    ) -> Result<SignalCode, Error> {
        let value = self
            .call(
                Method::POST,
                "/v1/signals",
                Some(key),
                Some(json!({ "invitation": invitation, "ttl_seconds": ttl_seconds })),
            )
            .await?;
        serde_json::from_value(value).map_err(|_| Error::Decode)
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
            .ok_or(Error::Decode)?;
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
    pub async fn health(&self) -> Result<Health, Error> {
        let value = self.call(Method::GET, "/healthz", None, None).await?;
        serde_json::from_value(value).map_err(|_| Error::Decode)
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
            canonical_string("POST", "/v1/signals", "abc123", 1_700_000_000, "nonce"),
            "orax-device-auth-v1\nPOST\n/v1/signals\nabc123\n1700000000\nnonce"
        );
    }

    #[test]
    fn method_is_normalised_to_upper_case() {
        assert_eq!(
            canonical_string("post", "/v1/signals", "abc", 1, "n"),
            canonical_string("POST", "/v1/signals", "abc", 1, "n")
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
