//! Host-library commands: profiles, groups, tags, history, thumbnails.
//!
//! All storage calls are synchronous SQLite (`vnc_store::Store`), so every
//! command hops to `spawn_blocking` via [`super::blocking`].

use tauri::{AppHandle, State};
use vnc_store::{Group, HistoryEntry, HostProfile, Tag};

use crate::state::AppState;

#[tauri::command]
pub async fn list_hosts(state: State<'_, AppState>) -> Result<Vec<HostProfile>, String> {
    let store = state.store.clone();
    super::blocking(move || store.list_hosts()).await
}

#[tauri::command]
pub async fn get_host(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<Option<HostProfile>, String> {
    let store = state.store.clone();
    super::blocking(move || store.get_host(&host_id)).await
}

#[tauri::command]
pub async fn save_host(
    state: State<'_, AppState>,
    profile: HostProfile,
) -> Result<HostProfile, String> {
    let store = state.store.clone();
    validate_profile(&profile)?;
    let returned = profile.clone();
    super::blocking(move || store.save_host(&profile)).await?;
    Ok(returned)
}

/// What a saved profile has to satisfy before it reaches the store.
///
/// The editor validates what a person types, but the store is also written by
/// imports, Undo and the agent's adopt path, and several columns end up in
/// places that do not render free text well: a native window title, a tray
/// menu row, a picker label. So the check is narrow and about shape only:
/// a real name (no control characters, a sane length), a bare endpoint (no
/// whitespace), and a port that can be dialled. Nothing here rewrites what
/// was sent; a refusal is reported instead of a silent repair.
fn validate_profile(profile: &HostProfile) -> Result<(), String> {
    let name = profile.friendly_name.trim();
    if name.is_empty() {
        return Err("a computer needs a name".into());
    }
    if name.chars().count() > 256 {
        return Err("the name is too long (256 characters at most)".into());
    }
    if name.chars().any(char::is_control) {
        return Err("the name contains control characters".into());
    }
    // A Boundary computer is saved by its lasting ID, for unattended
    // access. An invitation is temporary and is never a host.
    if profile.protocol == "boundary" {
        return boundary_session::unattended::validate_machine_id(&profile.address).map_err(|_| {
            "Boundary invitations are temporary. Save a computer by its unattended ID, or start a new support connection"
                .to_string()
        });
    }
    let address = profile.address.trim();
    if address.is_empty() {
        return Err("a computer needs an address".into());
    }
    if address.chars().count() > 255 {
        return Err("the address is too long (255 characters at most)".into());
    }
    if address.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("the address must not contain spaces".into());
    }
    if profile.port == 0 {
        return Err("the port must be between 1 and 65535".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_host(state: State<'_, AppState>, host_id: String) -> Result<(), String> {
    let store = state.store.clone();
    let credentials = state.credentials.clone();
    super::blocking(move || {
        store.delete_host(&host_id).map_err(|error| error.to_string())?;
        // The stored credential goes with the host.
        //
        // `Store::delete_host` only removes the OS keychain entry, and only
        // as a best effort. The encrypted-file fallback, which is what the
        // app uses whenever the keychain is unavailable, kept the secret: the
        // UI said "Saved passwords are gone", and the Undo button, which
        // restores the host under the same id, brought the password back with
        // it. A secret that outlives the host it belongs to is a secret the
        // person never asked to keep.
        //
        // A locked vault is not a failure worth refusing the delete over:
        // the host is gone either way, and the entry is unreachable until
        // the vault is unlocked, at which point it can be removed.
        if let Err(error) = credentials.delete(&host_id) {
            tracing::warn!(host_id = %host_id, error = %error, "could not remove the stored credential");
        }
        Ok::<(), String>(())
    })
    .await
}

/// Bump `last_connected`/`connect_count` after a successful connect.
#[tauri::command]
pub async fn touch_connected(state: State<'_, AppState>, host_id: String) -> Result<(), String> {
    let store = state.store.clone();
    super::blocking(move || store.touch_connected(&host_id)).await
}

#[tauri::command]
pub async fn list_groups(state: State<'_, AppState>) -> Result<Vec<Group>, String> {
    let store = state.store.clone();
    super::blocking(move || store.list_groups()).await
}

#[tauri::command]
pub async fn save_group(state: State<'_, AppState>, group: Group) -> Result<Group, String> {
    let store = state.store.clone();
    let returned = group.clone();
    super::blocking(move || store.save_group(&group)).await?;
    Ok(returned)
}

#[tauri::command]
pub async fn delete_group(state: State<'_, AppState>, group_id: String) -> Result<(), String> {
    let store = state.store.clone();
    super::blocking(move || store.delete_group(&group_id)).await
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let store = state.store.clone();
    super::blocking(move || store.list_tags()).await
}

#[tauri::command]
pub async fn save_tag(state: State<'_, AppState>, tag: Tag) -> Result<Tag, String> {
    let store = state.store.clone();
    let returned = tag.clone();
    super::blocking(move || store.save_tag(&tag)).await?;
    Ok(returned)
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, tag_id: String) -> Result<(), String> {
    let store = state.store.clone();
    super::blocking(move || store.delete_tag(&tag_id)).await
}

/// Replace the full tag set of a host.
#[tauri::command]
pub async fn set_host_tags(
    state: State<'_, AppState>,
    host_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    let store = state.store.clone();
    super::blocking(move || store.set_host_tags(&host_id, &tag_ids)).await
}

/// Move a multi-selection of hosts into a group in one atomic call, or out of
/// every group when `group_id` is `None`. See `Store::set_hosts_group`.
#[tauri::command]
pub async fn set_hosts_group(
    state: State<'_, AppState>,
    host_ids: Vec<String>,
    group_id: Option<String>,
) -> Result<(), String> {
    let store = state.store.clone();
    super::blocking(move || store.set_hosts_group(&host_ids, group_id.as_deref())).await
}

/// Add one tag to a multi-selection of hosts without disturbing their other
/// tags. See `Store::add_tag_to_hosts`.
#[tauri::command]
pub async fn add_tag_to_hosts(
    state: State<'_, AppState>,
    host_ids: Vec<String>,
    tag_id: String,
) -> Result<(), String> {
    let store = state.store.clone();
    super::blocking(move || store.add_tag_to_hosts(&host_ids, &tag_id)).await
}

/// Remove one tag from a multi-selection of hosts without disturbing their
/// other tags. See `Store::remove_tag_from_hosts`.
#[tauri::command]
pub async fn remove_tag_from_hosts(
    state: State<'_, AppState>,
    host_ids: Vec<String>,
    tag_id: String,
) -> Result<(), String> {
    let store = state.store.clone();
    super::blocking(move || store.remove_tag_from_hosts(&host_ids, &tag_id)).await
}

/// Connection history, newest first. `host_id = None` means all hosts.
#[tauri::command]
pub async fn list_history(
    state: State<'_, AppState>,
    host_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<HistoryEntry>, String> {
    let store = state.store.clone();
    super::blocking(move || store.list_history(host_id.as_deref(), limit.unwrap_or(100))).await
}

/// Thumbnail PNG for a host tile.
///
/// Returns the raw PNG bytes via `tauri::ipc::Response`, the binary
/// fast path, NOT base64 JSON. The webview receives an `ArrayBuffer`:
/// `new Blob([await invoke("get_thumbnail", { hostId })])`. An empty body
/// means "no thumbnail yet".
#[tauri::command]
pub async fn get_thumbnail(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<tauri::ipc::Response, String> {
    let store = state.store.clone();
    let bytes: Option<Vec<u8>> = super::blocking(move || store.load_thumbnail(&host_id)).await?;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

/// Read a global app setting from the store's KV table.
///
/// Used for preferences the Rust side must consult at connect time (so they
/// cannot live in the webview's localStorage), e.g. `lossless_refresh`.
#[tauri::command]
pub async fn get_app_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    // Off the runtime, like every other storage call in this file: the store
    // is synchronous SQLite and takes a lock on the connection.
    let store = state.store.clone();
    super::blocking(move || store.get_setting(&key)).await
}

/// Write a global app setting.
///
/// One setting has an effect beyond being stored: `agent_plane_enabled` binds
/// or unlinks the `dvvp.v1` socket. It is applied here rather than at the next
/// launch so that switching the plane on is a switch and not a restart, and so
/// that switching it off means the socket is gone at that moment rather than
/// at the next one. `app` is injected by Tauri and is not part of the invoke
/// surface, so the webview's call is unchanged.
#[tauri::command]
pub async fn set_app_setting(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let store = state.store.clone();
    let written = key.clone();
    let wanted = value.clone();
    super::blocking(move || store.set_setting(&written, &wanted)).await?;
    if key == crate::agent::AGENT_PLANE_ENABLED_KEY {
        crate::commands::agent::apply(&app, crate::agent::plane_enabled(Some(&value)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(name: &str, address: &str, port: u16) -> HostProfile {
        HostProfile {
            friendly_name: name.into(),
            address: address.into(),
            port,
            ..Default::default()
        }
    }

    /// The ordinary case must keep working, including a non-Latin name: the
    /// check is about shape, not about what alphabet a person uses.
    #[test]
    fn an_ordinary_profile_passes() {
        assert!(validate_profile(&profile("غرفة الاجتماعات", "10.0.0.4", 5900)).is_ok());
        assert!(validate_profile(&profile("Studio — iMac", "studio.local", 5901)).is_ok());
    }

    #[test]
    fn a_profile_without_a_real_name_is_refused() {
        assert!(validate_profile(&profile("", "10.0.0.4", 5900)).is_err());
        assert!(validate_profile(&profile("   ", "10.0.0.4", 5900)).is_err());
        // A newline reaches a native window title and a tray row.
        assert!(validate_profile(&profile("living\nroom", "10.0.0.4", 5900)).is_err());
    }

    #[test]
    fn a_profile_without_a_bare_endpoint_is_refused() {
        assert!(validate_profile(&profile("Studio", "", 5900)).is_err());
        assert!(validate_profile(&profile("Studio", "  ", 5900)).is_err());
        assert!(validate_profile(&profile("Studio", "10.0.0.4 5900", 5900)).is_err());
        assert!(validate_profile(&profile("Studio", "10.0.0.4", 0)).is_err());
    }

    #[test]
    fn a_boundary_profile_still_needs_an_unattended_id() {
        let mut boundary = profile("Front desk", "not-a-machine-id", 0);
        boundary.protocol = "boundary".into();
        assert!(validate_profile(&boundary).is_err());
    }
}
