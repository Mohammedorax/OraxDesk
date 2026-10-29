//! Keeping the native menu in step with the session in front.
//!
//! The View and Session menus duplicate the whole floating toolbar, because
//! Preferences can switch that toolbar off, so they have to show which
//! options are actually in force. The webview owns all of that state (and
//! most of the monitor list is computed there rather than read off the wire),
//! so it pushes a snapshot through here.

use tauri::{AppHandle, State};

use crate::menu::Lang;
use crate::state::AppState;

/// Apply a state snapshot to the native menu.
///
/// `async` deliberately, and not only for form: a synchronous tauri command
/// runs on the main thread, while every menu mutation posts a closure to that
/// same thread and blocks waiting for the answer. Called synchronously it
/// would deadlock the app on the first push.
#[tauri::command]
pub async fn sync_session_menu(
    app: AppHandle,
    update: crate::menu::MenuSync,
) -> Result<(), String> {
    crate::menu::sync(&app, update);
    Ok(())
}

/// Tell the shell which language the window is in, and rebuild the native
/// menus in it.
///
/// The menu bar is built in Rust before any webview exists, so it cannot read
/// the frontend's catalogue: the choice is written here, into the same
/// settings table the rest of the shell uses, and the menu and the tray are
/// rebuilt from it. Idempotent on purpose — the webview calls this on mount as
/// well as on a switch, and an unchanged language must not cost a rebuild.
#[tauri::command]
pub async fn set_ui_language(
    app: AppHandle,
    state: State<'_, AppState>,
    lang: String,
) -> Result<(), String> {
    let lang = Lang::parse(&lang);
    let store = state.store.clone();
    let wanted = lang.as_str().to_string();
    let stored = super::blocking(move || store.get_setting(crate::menu::LANGUAGE_KEY)).await?;
    if stored.as_deref() == Some(wanted.as_str()) {
        return Ok(());
    }
    let store = state.store.clone();
    let value = wanted.clone();
    super::blocking(move || store.set_setting(crate::menu::LANGUAGE_KEY, &value)).await?;
    crate::menu::apply(&app, lang).map_err(|e| e.to_string())?;
    crate::tray::set_language(&app, lang);
    Ok(())
}
