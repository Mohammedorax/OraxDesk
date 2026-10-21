//! Registry commands: the optional Cloudflare Worker that publishes an
//! invitation under a short numeric code.
//!
//! Everything here is additive. When no registry URL is configured the app
//! keeps using the shared code service (or a full invitation), exactly as
//! before; a failing registry call is reported as an error the caller can fall
//! back from, never a panic and never a blocked window.

use boundary_session::unattended::{load_or_create_key, SecretKey};
use orax_registry::{keys, Client, DeviceKeys, RegistryKey};

/// This computer's lasting identity, the same key Boundary already uses.
fn machine_key() -> Result<SecretKey, String> {
    let dir = boundary_provision::platform::data_dir().map_err(|error| format!("{error:#}"))?;
    load_or_create_key(&dir.join("machine.key")).map_err(|error| format!("{error:#}"))
}

/// This helper's lasting identity, so a paired computer recognises it later.
fn helper_key() -> Result<SecretKey, String> {
    let dir = boundary_provision::platform::data_dir().map_err(|error| format!("{error:#}"))?;
    load_or_create_key(&dir.join("boundary-helper.key")).map_err(|error| format!("{error:#}"))
}

/// The key the registry calls are signed with.
///
/// It is NOT the identity above, and the difference is the whole point: the
/// identity is trusted by every machine that ever paired this one, so a leak
/// of it is a leak of all of them, while a leak of the registry key is a leak
/// of this one service.
///
/// It lives in the OS keychain, so it is not in a file beside the identity.
fn registry_key(account: &str) -> Result<RegistryKey, String> {
    let dir = boundary_provision::platform::data_dir().map_err(|error| format!("{error:#}"))?;
    RegistryKey::load_or_create(account, dir).map_err(|error| format!("{error:#}"))
}

/// This computer's two keys: the identity it is known by, and the key it
/// signs the registry with.
///
/// The two must differ, and the check is not decoration: the identity is
/// trusted by every machine that ever paired with this one, and a registry
/// key that is the identity would make a leak of it a leak of all of them.
fn machine_keys() -> Result<DeviceKeys, String> {
    let identity = machine_key()?;
    let registry = registry_key(keys::ACCOUNT_MACHINE)?;
    DeviceKeys::new(identity, registry.secret().clone()).map_err(|error| error.to_string())
}

/// This helper's two keys.
fn helper_keys() -> Result<DeviceKeys, String> {
    let identity = helper_key()?;
    let registry = registry_key(keys::ACCOUNT_HELPER)?;
    DeviceKeys::new(identity, registry.secret().clone()).map_err(|error| error.to_string())
}

/// The address directory's settings, when a registry is configured.
///
/// A machine publishes its address there with its REGISTRY key, so the
/// directory can tell that the address belongs to the device that claims it.
/// A helper only looks other machines up, and publishes nothing: a helper is
/// not a machine anyone connects to.
///
/// `None` when no registry is configured, and the machine then publishes to
/// iroh's public directory exactly as it always has.
pub fn machine_directory_options() -> Result<Option<boundary_session::DirectoryOptions>, String> {
    let Some(url) = configured_url() else {
        return Ok(None);
    };
    let registry = registry_key(keys::ACCOUNT_MACHINE)?;
    Ok(Some(boundary_session::DirectoryOptions {
        url,
        signing_key: Some(registry.secret().clone()),
    }))
}

fn client(url: &str) -> Result<Client, String> {
    Client::new(url).map_err(|error| error.to_string())
}

/// This computer's endpoint id and the nine-digit number derived from it, for
/// the always-visible card on the library screen. It needs no network.
#[derive(serde::Serialize)]
pub struct MachineIdentity {
    pub id: String,
    pub number: String,
}

#[tauri::command]
pub async fn machine_identity() -> Result<MachineIdentity, String> {
    // The key lives on disk or in the keychain, so reading it is I/O. A
    // command that is not `async` runs inline on the IPC thread, which is the
    // main thread, and the window freezes behind it. The sibling commands
    // below already hop to a blocking thread for the same reason.
    //
    // The identity is enough here: the id and the number are both derived
    // from it, and the registry key is not part of either.
    let key = tokio::task::spawn_blocking(machine_key)
        .await
        .map_err(|error| error.to_string())??;
    Ok(MachineIdentity {
        id: boundary_session::unattended::machine_id(&key),
        number: orax_registry::device_number(&key),
    })
}

/// Registry origin from the environment, for a deployment that wants the Worker
/// before the UI grows a setting for it. Empty or missing means "not configured",
/// and every existing path keeps working untouched.
pub fn configured_url() -> Option<String> {
    std::env::var("ORAX_REGISTRY_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Resolve a code through a known registry origin. Used by the connect path so
/// the fallback logic lives in one place.
pub async fn resolve_code(url: &str, code: &str) -> Result<String, String> {
    client(url)?
        .resolve_signal(code)
        .await
        .map_err(|error| error.to_string())
}

/// Whether the configured registry is up and has its sealing key, so the UI can
/// tell a user why codes are unavailable instead of showing a dead button.
#[tauri::command]
pub async fn registry_health(url: String) -> Result<orax_registry::Health, String> {
    client(&url)?
        .health()
        .await
        .map_err(|error| error.to_string())
}

/// Host side: publish an invitation and return its code and revoke token.
#[tauri::command]
pub async fn registry_create_code(
    url: String,
    invitation: String,
    ttl_seconds: Option<u32>,
) -> Result<orax_registry::SignalCode, String> {
    let keys = tokio::task::spawn_blocking(machine_keys)
        .await
        .map_err(|error| error.to_string())??;
    client(&url)?
        .create_signal(&keys, &invitation, ttl_seconds.unwrap_or(600))
        .await
        .map_err(|error| error.to_string())
}

/// Helper side: turn a typed code into the invitation to connect with.
#[tauri::command]
pub async fn registry_resolve_code(url: String, code: String) -> Result<String, String> {
    client(&url)?
        .resolve_signal(&code)
        .await
        .map_err(|error| error.to_string())
}

/// Helper side: turn the nine-digit number a person reads out into that
/// device's endpoint id, which is what an unattended connection needs.
#[tauri::command]
pub async fn registry_lookup_number(
    url: String,
    number: String,
) -> Result<orax_registry::DeviceRecord, String> {
    client(&url)?
        .lookup_by_number(&number)
        .await
        .map_err(|error| error.to_string())
}

/// Host side: withdraw a code before it is used.
#[tauri::command]
pub async fn registry_revoke_code(url: String, revoke_token: String) -> Result<(), String> {
    client(&url)?
        .revoke_signal(&revoke_token)
        .await
        .map_err(|error| error.to_string())
}

/// Register this computer under its existing key, so the registry knows it.
/// Idempotent: registering again only refreshes the metadata.
#[tauri::command]
pub async fn registry_register_device(url: String) -> Result<orax_registry::DeviceRecord, String> {
    let keys = tokio::task::spawn_blocking(machine_keys)
        .await
        .map_err(|error| error.to_string())??;
    let computer = boundary_provision::platform::computer_name();
    client(&url)?
        .register(&keys, Some(computer.as_str()), env!("CARGO_PKG_VERSION"))
        .await
        .map_err(|error| error.to_string())
}

/// Register this helper under its lasting key. Separate from the machine
/// registration because a helper is a different device with its own key.
#[tauri::command]
pub async fn registry_register_helper(url: String) -> Result<orax_registry::DeviceRecord, String> {
    let keys = tokio::task::spawn_blocking(helper_keys)
        .await
        .map_err(|error| error.to_string())??;
    let computer = boundary_provision::platform::computer_name();
    client(&url)?
        .register(&keys, Some(computer.as_str()), env!("CARGO_PKG_VERSION"))
        .await
        .map_err(|error| error.to_string())
}
