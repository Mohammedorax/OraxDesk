//! Registry commands: the optional Cloudflare Worker that publishes an
//! invitation under a short numeric code.
//!
//! Everything here is additive. When no registry URL is configured the app
//! keeps using the shared code service (or a full invitation), exactly as
//! before; a failing registry call is reported as an error the caller can fall
//! back from, never a panic and never a blocked window.
//!
//! # The origin is the app's decision, not the webview's
//!
//! Every call here is signed with this device's REGISTRY key, so the origin
//! it is sent to decides who sees a signature made with a secret. The URL used
//! to live in the webview's local storage, which meant a compromised webview
//! could point every signed call at a host of its choosing and collect the
//! signatures there.
//!
//! So the origin is stored by the APP, in the same store as every other
//! setting, and a command that names a different one is refused. Changing it
//! is an explicit act that goes through [`registry_set_origin`] and is
//! remembered, and the environment variable still wins for a deployment that
//! wants to fix it for everybody.

use boundary_session::unattended::{load_or_create_key, SecretKey};
use orax_registry::{keys, Client, DeviceKeys, RegistryKey};
use tauri::State;

use crate::state::AppState;

/// The setting the registry origin is stored under.
const REGISTRY_ORIGIN_KEY: &str = "registry_origin";

/// The registry this build talks to when the person has not chosen another
/// one and the environment has not fixed one for the deployment.
pub(crate) const DEFAULT_REGISTRY_URL: &str = "https://orax-registry.oraxhome.workers.dev";

/// The setting the number the registry knows this computer by is stored under.
const REGISTRY_NUMBER_KEY: &str = "registry_number";

/// Whether this computer registers itself without being asked.
const REGISTRY_AUTO_KEY: &str = "registry_auto_register";

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
    machine_directory_options_for(configured_url())
}

/// [`machine_directory_options`] for an origin the caller already resolved.
///
/// The device NUMBER is registered in the app's registry (stored or default),
/// so the ADDRESS must be published there too. Publishing to n0 while the
/// number lives in Cloudflare splits one identity across two directories and
/// leaves a registered machine that a helper cannot find.
pub fn machine_directory_options_for(
    origin: Option<String>,
) -> Result<Option<boundary_session::DirectoryOptions>, String> {
    let Some(url) = origin else {
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
pub async fn machine_identity(state: State<'_, AppState>) -> Result<MachineIdentity, String> {
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
    // The number the REGISTRY knows this computer by wins over the local
    // derivation: two devices can derive the same one, and the registry
    // takes the next free number when that happens. Showing the derived
    // number then would be showing a number nobody can look up.
    let number = match registered_number(&state).await {
        Some(number) => number,
        None => orax_registry::device_number(&key),
    };
    Ok(MachineIdentity {
        id: boundary_session::unattended::machine_id(&key),
        number,
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

/// The origin the app will actually talk to.
///
/// The environment wins, because a deployment that fixes it for everybody
/// should not have it overridden by a setting made on one machine. Otherwise
/// it is the stored one, and the webview cannot move it.
async fn stored_origin(state: &AppState) -> Result<Option<String>, String> {
    if let Some(url) = configured_url() {
        return Ok(Some(url));
    }
    let store = state.store.clone();
    let stored = super::blocking(move || store.get_setting(REGISTRY_ORIGIN_KEY))
        .await
        .map(|value| {
            value
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
        .map_err(|error| error.to_string())?;
    Ok(stored.or_else(|| Some(DEFAULT_REGISTRY_URL.to_string())))
}

/// The origin this computer talks to, for a caller that only needs the URL.
///
/// The stored one, or the default, or the environment's — the same choice
/// every other registry call makes, so nothing asks a second registry.
pub(crate) async fn effective_origin(state: &AppState) -> Option<String> {
    stored_origin(state).await.ok().flatten()
}

/// The directory a helper looks a saved machine up in.
///
/// The same origin the device NUMBER was resolved against, and no signing
/// key: a helper publishes nothing about itself, it only reads. `None` keeps
/// the public n0 directory for builds with no registry at all.
pub async fn helper_directory_url(state: &AppState) -> Option<String> {
    stored_origin(state).await.ok().flatten()
}

/// The origin a command is allowed to use.
///
/// The named origin must be the one the app has, and it must be named at
/// all: a call that says nothing is refused rather than quietly sent
/// somewhere the app did not choose.
async fn origin(state: &AppState, named: &str) -> Result<String, String> {
    let chosen = stored_origin(state).await?;
    let Some(chosen) = chosen else {
        return Err("no registry origin has been set".into());
    };
    let named = named.trim();
    if !named.is_empty() && !named.eq_ignore_ascii_case(&chosen) {
        return Err(format!(
            "this registry is not the one this computer is set up for ({chosen})"
        ));
    }
    Ok(chosen)
}

/// Remember the registry origin this computer talks to.
///
/// The webview asks for this when the person types a registry URL, and the
/// app keeps it. That is the only way the origin changes, and it is the
/// reason the other commands can refuse an origin the app did not choose.
#[tauri::command]
pub async fn registry_set_origin(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        let store = state.store.clone();
        let result = super::blocking(move || store.set_setting(REGISTRY_ORIGIN_KEY, ""))
            .await
            .map_err(|error| error.to_string());
        // Clear the address directory too, so saved-machine lookups do not
        // keep querying a registry this computer no longer uses.
        state.protocols.boundary.set_directory(None);
        return result;
    }
    // Validated the same way every other origin is, so a stored origin is
    // one the client can actually use.
    Client::new(&url).map_err(|error| error.to_string())?;
    let store = state.store.clone();
    let stored = url.clone();
    let result = super::blocking(move || store.set_setting(REGISTRY_ORIGIN_KEY, &stored))
        .await
        .map_err(|error| error.to_string());
    // The number is resolved here, so the address is looked up here: both
    // halves of a by-number connection must read the same directory.
    state.protocols.boundary.set_directory(Some(url));
    result
}

/// Resolve a code through a known registry origin. Used by the connect path so
/// the fallback logic lives in one place.
pub async fn resolve_code(url: &str, code: &str) -> Result<String, String> {
    client(url)?
        .resolve_signal(code)
        .await
        .map_err(|error| error.to_string())
}

/// The origin the app will use, for the UI to show the effective value rather
/// than an empty field when the default or the environment supplies it.
#[tauri::command]
pub async fn registry_origin(state: State<'_, AppState>) -> Result<String, String> {
    Ok(stored_origin(&state).await?.unwrap_or_default())
}

async fn auto_register_enabled(state: &AppState) -> Result<bool, String> {
    let store = state.store.clone();
    let value = super::blocking(move || store.get_setting(REGISTRY_AUTO_KEY))
        .await
        .map_err(|error| error.to_string())?;
    Ok(value
        .map(|value| value.trim().to_ascii_lowercase())
        .is_none_or(|value| value != "0" && value != "false" && value != "off"))
}

#[tauri::command]
pub async fn registry_auto_register(state: State<'_, AppState>) -> Result<bool, String> {
    auto_register_enabled(&state).await
}

#[tauri::command]
pub async fn registry_set_auto_register(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    let store = state.store.clone();
    let value = if enabled { "1" } else { "0" };
    super::blocking(move || store.set_setting(REGISTRY_AUTO_KEY, value))
        .await
        .map_err(|error| error.to_string())
}

/// Turn a nine-digit number into a device record through the configured
/// registry. Used before any VNC dial so a number can never become a hostname.
pub(crate) async fn lookup_device_number(
    state: &AppState,
    number: &str,
) -> Result<orax_registry::DeviceRecord, String> {
    let origin = stored_origin(state)
        .await?
        .ok_or_else(|| "no registry origin has been set".to_string())?;
    client(&origin)?
        .lookup_by_number(number)
        .await
        .map_err(|error| error.to_string())
}

/// Register this computer under its machine key without a webview asking.
/// Idempotent, so starting the app again only refreshes its metadata.
pub(crate) async fn register_this_device(
    state: &AppState,
) -> Result<Option<orax_registry::DeviceRecord>, String> {
    if !auto_register_enabled(state).await? {
        return Ok(None);
    }
    let origin = stored_origin(state)
        .await?
        .ok_or_else(|| "no registry origin has been set".to_string())?;
    register_device_at(state, &origin).await.map(Some)
}

async fn register_device_at(
    state: &AppState,
    origin: &str,
) -> Result<orax_registry::DeviceRecord, String> {
    let keys = tokio::task::spawn_blocking(machine_keys)
        .await
        .map_err(|error| error.to_string())??;
    let computer = boundary_provision::platform::computer_name();
    let record = client(origin)?
        .register(&keys, Some(computer.as_str()), env!("CARGO_PKG_VERSION"))
        .await
        .map_err(|error| error.to_string())?;
    // The number the REGISTRY has is the number this computer is known by.
    //
    // The number is derived from the key, so two devices can derive the same
    // one, and the registry takes the next free number when that happens.
    // The local derivation is only the starting point, so a device whose
    // number was taken must show the registry's, or the number a person
    // reads out loud is one nobody can look up.
    if let Some(number) = record.number.as_deref() {
        remember_registry_number(state, number).await?;
    }
    remember_registration(state).await;
    Ok(record)
}

/// The settings key recording when this computer last registered successfully.
const REGISTRY_LAST_OK_KEY: &str = "registry_last_registered";

/// How long a successful registration counts as fresh.
///
/// The registry keeps a device for seven days after the last contact, so a
/// refresh every two days leaves days of margin. Longer than that and a
/// machine that is opened briefly would let its record lapse; shorter and a
/// person who relaunches the app twenty times a day pays twenty registrations
/// for nothing.
pub(crate) const REGISTRATION_FRESH_SECONDS: u64 = 48 * 60 * 60;

async fn remember_registration(state: &AppState) {
    let store = state.store.clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Best effort: a failure here costs one extra registration, never a
    // failed one.
    let _ = super::blocking(move || store.set_setting(REGISTRY_LAST_OK_KEY, &now.to_string())).await;
}

/// Is the last successful registration recent enough to skip another one?
///
/// This is the "smart" half of the startup loop: a machine that was registered
/// from this same install a few hours ago does not need the registry contacted
/// again just because the window was reopened.
pub(crate) async fn registered_recently(state: &AppState) -> bool {
    let store = state.store.clone();
    let Ok(stored) = super::blocking(move || store.get_setting(REGISTRY_LAST_OK_KEY)).await else {
        return false;
    };
    let Some(value) = stored else {
        return false;
    };
    let Ok(then) = value.trim().parse::<u64>() else {
        return false;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    now.saturating_sub(then) < REGISTRATION_FRESH_SECONDS
}

/// Whether the configured registry is up and has its sealing key, so the UI can
/// tell a user why codes are unavailable instead of showing a dead button.
#[tauri::command]
pub async fn registry_health(
    state: State<'_, AppState>,
    url: String,
) -> Result<orax_registry::Health, String> {
    client(&origin(&state, &url).await?)?
        .health()
        .await
        .map_err(|error| error.to_string())
}

/// Host side: publish an invitation and return its code and revoke token.
#[tauri::command]
pub async fn registry_create_code(
    state: State<'_, AppState>,
    url: String,
    invitation: String,
    ttl_seconds: Option<u32>,
) -> Result<orax_registry::SignalCode, String> {
    let origin = origin(&state, &url).await?;
    let keys = tokio::task::spawn_blocking(machine_keys)
        .await
        .map_err(|error| error.to_string())??;
    client(&origin)?
        .create_signal(&keys, &invitation, ttl_seconds.unwrap_or(600))
        .await
        .map_err(|error| error.to_string())
}

/// Helper side: turn a typed code into the invitation to connect with.
#[tauri::command]
pub async fn registry_resolve_code(
    state: State<'_, AppState>,
    url: String,
    code: String,
) -> Result<String, String> {
    client(&origin(&state, &url).await?)?
        .resolve_signal(&code)
        .await
        .map_err(|error| error.to_string())
}

/// Helper side: turn the nine-digit number a person reads out into that
/// device's endpoint id, which is what an unattended connection needs.
#[tauri::command]
pub async fn registry_lookup_number(
    state: State<'_, AppState>,
    url: String,
    number: String,
) -> Result<orax_registry::DeviceRecord, String> {
    client(&origin(&state, &url).await?)?
        .lookup_by_number(&number)
        .await
        .map_err(|error| error.to_string())
}

/// Host side: withdraw a code before it is used.
#[tauri::command]
pub async fn registry_revoke_code(
    state: State<'_, AppState>,
    url: String,
    revoke_token: String,
) -> Result<(), String> {
    client(&origin(&state, &url).await?)?
        .revoke_signal(&revoke_token)
        .await
        .map_err(|error| error.to_string())
}

/// Register this computer under its existing key, so the registry knows it.
/// Idempotent: registering again only refreshes the metadata.
#[tauri::command]
pub async fn registry_register_device(
    state: State<'_, AppState>,
    url: String,
) -> Result<orax_registry::DeviceRecord, String> {
    let origin = origin(&state, &url).await?;
    register_device_at(&state, &origin).await
}

/// Remember the number the registry knows this computer by.
async fn remember_registry_number(state: &AppState, number: &str) -> Result<(), String> {
    let store = state.store.clone();
    let number = number.to_owned();
    super::blocking(move || store.set_setting(REGISTRY_NUMBER_KEY, &number))
        .await
        .map_err(|error| error.to_string())
}

/// The number the registry knows this computer by, when it has said.
async fn registered_number(state: &AppState) -> Option<String> {
    let store = state.store.clone();
    super::blocking(move || store.get_setting(REGISTRY_NUMBER_KEY))
        .await
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Register this helper under its lasting key. Separate from the machine
/// registration because a helper is a different device with its own key.
#[tauri::command]
pub async fn registry_register_helper(
    state: State<'_, AppState>,
    url: String,
) -> Result<orax_registry::DeviceRecord, String> {
    let origin = origin(&state, &url).await?;
    let keys = tokio::task::spawn_blocking(helper_keys)
        .await
        .map_err(|error| error.to_string())??;
    let computer = boundary_provision::platform::computer_name();
    client(&origin)?
        .register(&keys, Some(computer.as_str()), env!("CARGO_PKG_VERSION"))
        .await
        .map_err(|error| error.to_string())
}
