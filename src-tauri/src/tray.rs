//! Tray icon with recent hosts and Quit.
//!
//! The recent-hosts list is a snapshot taken at startup (rebuilt via
//! [`install`] if we ever want live refresh); clicking one focuses the main
//! window and emits `tray://connect` with the host id so the frontend starts
//! the connection through its normal path.
//!
//! The two labels are built in the language the shell's menus use
//! (`menu::stored_language`), and [`set_language`] rebuilds this menu when the
//! person switches language so the tray does not stay in the old one.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::menu::{self, Lang};
use crate::state::AppState;

const MAX_RECENT: usize = 5;

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let lang = menu::stored_language(app);
    let menu = build_menu(app, lang)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("OraxDesk")
        .on_menu_event(|app, event| handle_tray_event(app, event.id().as_ref()));
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Replace the tray menu with one built in `lang`, keeping the same tray.
pub fn set_language(app: &AppHandle, lang: Lang) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    match build_menu(app, lang) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                tracing::warn!("could not relabel the tray menu: {e}");
            }
        }
        Err(e) => tracing::warn!("could not rebuild the tray menu: {e}"),
    }
}

fn build_menu(app: &AppHandle, lang: Lang) -> tauri::Result<Menu<Wry>> {
    let (open_label, quit_label) = menu::tray_labels(lang);
    let mut builder = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("tray:open", open_label).build(app)?);

    let recent = recent_hosts(app);
    if !recent.is_empty() {
        builder = builder.separator();
        for (host_id, name) in &recent {
            // Host names are user/server-derived; menu items render plain
            // text natively so no escaping is needed.
            builder = builder
                .item(&MenuItemBuilder::with_id(format!("tray:host:{host_id}"), name).build(app)?);
        }
    }
    builder
        .separator()
        .item(&MenuItemBuilder::with_id("tray:quit", quit_label).build(app)?)
        .build()
}

fn handle_tray_event(app: &AppHandle, id: &str) {
    match id {
        "tray:open" => show_main(app),
        "tray:quit" => app.exit(0),
        host_item if host_item.starts_with("tray:host:") => {
            let host_id = &host_item["tray:host:".len()..];
            show_main(app);
            let _ = app.emit_to(
                "main",
                "tray://connect",
                serde_json::json!({ "hostId": host_id }),
            );
        }
        _ => {}
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Best effort: most recently connected saved hosts, newest first.
fn recent_hosts(app: &AppHandle) -> Vec<(String, String)> {
    let Some(state) = app.try_state::<AppState>() else {
        return Vec::new();
    };
    match state.store.list_hosts() {
        Ok(mut hosts) => {
            hosts.sort_by_key(|h| std::cmp::Reverse(h.last_connected));
            hosts
                .into_iter()
                .filter(|h| h.last_connected.is_some())
                .take(MAX_RECENT)
                .map(|h| (h.id, h.friendly_name))
                .collect()
        }
        Err(e) => {
            tracing::warn!("could not list hosts for tray menu: {e}");
            Vec::new()
        }
    }
}
