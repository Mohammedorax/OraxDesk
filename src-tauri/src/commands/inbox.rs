//! The support inbox: the numbers people send, and what the registry says.
//!
//! The list is LOCAL. A number is something somebody typed to the operator, a
//! note is the operator's own words, and neither is ever sent to the Worker.
//! The only thing that leaves this machine is a lookup of the number in the
//! registry, which is the same public lookup the connect path already makes.
//!
//! The state a row carries is what the registry answered the last time it was
//! checked, and it is deliberately conservative:
//!
//! * `reachable` — the registry has an address for this device, published
//!   within the last hour, so a helper can dial it.
//! * `no-address` — the device is registered but has published nothing. The
//!   fix is on that machine: switch on unattended access so it publishes.
//! * `revoked` — the operator revoked this device.
//! * `unknown` — the number is not registered here.
//! * `error` — the registry could not be asked.
//!
//! `unknown` is not "offline". The registry's `last_seen_at` is a 48-hour
//! registration keep-alive, and an address is "published", not "awake": this
//! app does not have a presence signal for a machine it has not connected to,
//! and saying otherwise would be a lie the operator acts on.

use crate::state::AppState;
use tauri::State;
use vnc_store::InboxEntry;

/// The digits of a nine-digit number, or a message saying what is wrong.
fn normalize_number(text: &str) -> Result<String, String> {
    let digits: String = text
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    if digits.len() != 9 {
        return Err("A device number is nine digits".into());
    }
    Ok(digits)
}

/// Add a number to the inbox.
///
/// The same number twice is one row: this is a list of machines, not a log of
/// messages.
#[tauri::command]
pub async fn inbox_add(
    state: State<'_, AppState>,
    number: String,
    note: Option<String>,
) -> Result<InboxEntry, String> {
    let number = normalize_number(&number)?;
    let note = note
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let store = state.store.clone();
    super::blocking(move || store.inbox_add(&number, note.as_deref()))
        .await
        .map_err(|error| error.to_string())
}

/// Every row, newest first.
#[tauri::command]
pub async fn inbox_list(state: State<'_, AppState>) -> Result<Vec<InboxEntry>, String> {
    let store = state.store.clone();
    super::blocking(move || store.inbox_list())
        .await
        .map_err(|error| error.to_string())
}

/// Forget a row. The machine it names is untouched.
#[tauri::command]
pub async fn inbox_remove(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let store = state.store.clone();
    super::blocking(move || store.inbox_remove(&id))
        .await
        .map_err(|error| error.to_string())
}

/// Ask the registry about every row and record what it said.
///
/// One pass, on demand. It is not a poller: the Worker's free plan is
/// hundred thousand requests a day and the lookup is rate limited per
/// address, so a list that refreshes itself in the background would spend the
/// budget on a screen nobody is looking at.
#[tauri::command]
pub async fn inbox_refresh(state: State<'_, AppState>) -> Result<Vec<InboxEntry>, String> {
    let rows = {
        let store = state.store.clone();
        super::blocking(move || store.inbox_list())
            .await
            .map_err(|error| error.to_string())?
    };
    let Some(url) = super::registry::effective_origin(&state).await else {
        return Err("no registry origin has been set".into());
    };
    let client = orax_registry::Client::new(&url).map_err(|error| error.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    for row in &rows {
        let (device_id, state_name, detail) = match client.lookup_by_number(&row.number).await {
            Ok(record) => {
                if record.revoked_at.is_some() {
                    (
                        Some(record.id),
                        "revoked",
                        Some("This device was revoked by the operator".to_string()),
                    )
                } else {
                    match client.lookup_address(&record.id).await {
                        Ok(Some(_)) => (
                            Some(record.id),
                            "reachable",
                            Some("It published an address, so a helper can dial it".to_string()),
                        ),
                        Ok(None) => (
                            Some(record.id),
                            "no-address",
                            Some(
                                "It is registered but has published no address. Switch on unattended access there"
                                    .to_string(),
                            ),
                        ),
                        Err(error) => (
                            Some(record.id),
                            "no-address",
                            Some(format!("It published no address: {error}")),
                        ),
                    }
                }
            }
            Err(error) => (
                None,
                "error",
                Some(format!("The registry could not be asked: {error}")),
            ),
        };
        let store = state.store.clone();
        let id = row.id.clone();
        super::blocking(move || {
            store.inbox_set_state(
                &id,
                device_id.as_deref(),
                &state_name,
                detail.as_deref(),
                now,
            )
        })
        .await
        .map_err(|error| error.to_string())?;
    }

    let store = state.store.clone();
    super::blocking(move || store.inbox_list())
        .await
        .map_err(|error| error.to_string())
}
