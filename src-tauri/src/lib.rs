//! OraxDesk Tauri shell.
//!
//! Thin adapter over the UI-agnostic crates (PRD/01 §1): `vnc-core` does the
//! protocol work, `vnc-store` persistence/keychain, `vnc-discovery` LAN
//! discovery. This crate wires them to windows, commands, channels, menu,
//! tray, and the capability-scoped IPC surface.

mod agent;
mod commands;
mod framing;
mod menu;
mod state;
mod thumbnail;
mod tray;
mod tunnel;
mod windows;

use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{Emitter, Manager, RunEvent, State};
use tauri_plugin_deep_link::DeepLinkExt;

use state::AppState;

/// A code delivered by `oraxdesk://join/<code>` before the webview was ready.
///
/// The URL can arrive at process start, when no frontend listener exists yet.
/// Holding it here lets the helper dialog ask for it once it mounts instead of
/// losing the link.
struct PendingHelpCode(Mutex<Option<String>>);

/// The code inside the deep links this app understands.
///
/// Both forms are accepted because the copy button and older shares can differ:
/// `oraxdesk://join/<code>` and `oraxdesk://help?code=<code>`. A full
/// invitation is never parsed here; it is pasted into the dialog itself.
fn help_code_from_url(value: &str) -> Option<String> {
    let value = value.trim();
    let rest = value
        .strip_prefix("oraxdesk://join/")
        .or_else(|| value.strip_prefix("oraxdesk://help/"))
        .or_else(|| value.strip_prefix("oraxdesk://help?code="))?;
    let code = rest
        .split(['?', '#', '&'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches('/');
    (!code.is_empty()).then(|| code.to_string())
}

fn record_help_code(app: &tauri::AppHandle, code: String) {
    if let Some(pending) = app.try_state::<PendingHelpCode>() {
        *pending.0.lock() = Some(code.clone());
    }
    let _ = app.emit("oraxdesk://help-code", code);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn take_pending_help_code(pending: State<'_, PendingHelpCode>) -> Option<String> {
    pending.0.lock().take()
}

/// Tear down everything a window owned: its sessions, its file transfers and
/// its remote shells.
///
/// Keyed on what the window actually OWNS, not on its label. A session used
/// to imply a window called `session-<id>`, but in tabbed view sessions live
/// in `main` alongside the library, so `main` closing has to tear its
/// sessions down exactly the way a session window does. Each call is a no-op
/// for a window that owns nothing, which is what `main` is in the
/// one-window-per-session mode.
///
/// Called on both `CloseRequested` and `Destroyed`: a window can be destroyed
/// without ever asking to close, and `CloseRequested` never fires for one
/// that was destroyed outright.
/// Keep a restored window on the screen it is actually on.
///
/// The window-state plugin faithfully restores the size from the last run,
/// which is right until the person moves to a smaller display: a 2182x1390
/// window on a 1440x960 screen puts the sidebar, the help buttons and the
/// bottom of every dialog outside the visible area. A beginner sees a broken
/// app and has no obvious way to fix it. Clamp the restored size to the
/// current monitor, leaving a small margin for the taskbar and window border.
fn fit_main_window(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let monitor = monitor.size();
    let max_width = ((monitor.width as f64) * 0.92).round() as u32;
    let max_height = ((monitor.height as f64) * 0.92).round() as u32;
    if size.width <= max_width && size.height <= max_height {
        return;
    }
    let width = size.width.min(max_width);
    let height = size.height.min(max_height);
    // A restored maximized window can be larger than the monitor when the
    // last run was on a bigger display. Unmaximize before resizing, or
    // Windows keeps the old maximized bounds and the resize does nothing.
    let _ = window.unmaximize();
    let _ = window.set_size(tauri::PhysicalSize::new(width, height));
    let _ = window.center();
    tracing::info!(
        width,
        height,
        monitor_width = monitor.width,
        monitor_height = monitor.height,
        "clamped the restored window to the current monitor"
    );
}

fn shutdown_window(window: &tauri::Window) {
    if let Some(state) = window.try_state::<AppState>() {
        state.shutdown_sessions_for_window(window.label());
    }
    if let Some(files) = window.try_state::<commands::files::FilesState>() {
        files.shutdown_for_window(window.label());
    }
    if let Some(ssh) = window.try_state::<commands::ssh::SshState>() {
        ssh.shutdown_for_window(window.label());
    }
}

pub fn run() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,deskvncviewer_lib=debug"));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            // Must be registered first so a second launch is forwarded before
            // any other plugin runs.
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                // A second launch from a link carries the URL as an argument.
                // It must be handled before the window is merely focused, or
                // the person sees the app come forward with an empty dialog.
                for arg in argv {
                    if let Some(code) = help_code_from_url(&arg) {
                        record_help_code(app, code);
                    }
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }))
            // The ONLY thing the global-shortcut plugin is used for is the
            // capture escape hatch. It is the wrong tool for capture itself
            // (PRD/06 §3: it is `RegisterHotKey`-based and system shortcuts
            // always win) but exactly right for a panic button that must work
            // even while a native hook is swallowing keys.
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            commands::capture::force_release(app);
                        }
                    })
                    .build(),
            )
            .plugin(tauri_plugin_window_state::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            // Storage lives under the per-user Tauri app data dir.
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let store = Arc::new(vnc_store::Store::open(Some(data_dir.clone()))?);
            let credentials = Arc::new(vnc_store::CredentialStore::new(data_dir.clone()));
            // The pin store is built first and shared, because three
            // features verify against it: the Files panel, the RFB tunnel and
            // the SSH protocol driver. One store is the invariant, so it is
            // constructed once here rather than by whichever of them happens
            // to start first.
            let boundary_dir = data_dir.clone();
            let files_state = commands::files::FilesState::new(data_dir);
            let host_keys = files_state.host_key_verifier();
            app.manage(AppState::new(store, credentials, host_keys));
            app.manage(PendingHelpCode(Mutex::new(None)));

            // A link can arrive while the app is already running, or in the
            // arguments of the process that was just started. Both paths go
            // through the same pending slot, so a webview that has not mounted
            // yet can still take the code when it is ready.
            let deep_link_app = app.handle().clone();
            let _ = deep_link_app.clone().deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(code) = help_code_from_url(url.as_str()) {
                        record_help_code(&deep_link_app, code);
                    }
                }
            });
            for arg in std::env::args().skip(1) {
                if let Some(code) = help_code_from_url(&arg) {
                    record_help_code(app.handle(), code);
                }
            }
            // Make the association work even when the app was started from a
            // portable copy or an installer that could not write it. The
            // installer still registers it for the normal case.
            let _ = app.handle().deep_link().register_all();

            if let Some(window) = app.get_webview_window("main") {
                fit_main_window(&window);
            }
            // The window-state plugin restores after setup, and in a maximized
            // restore it can still be larger than the current display. Check
            // once more after the restore has landed, then leave the window
            // alone so a person can resize it normally.
            let fit_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                if let Some(window) = fit_app.get_webview_window("main") {
                    fit_main_window(&window);
                }
            });
            // Registration is state-driven, not a heartbeat: on startup it
            // runs once (three seconds in, so a cold launch is not competing
            // with window creation), and then only as a keep-alive. The
            // registry sweeps a device that has not been seen for seven days,
            // so a refresh every two days keeps the number discoverable with
            // days of margin, and costs a quarter of the writes the old
            // six-hour loop did — which is the binding free-plan limit.
            let registry_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut delay = 3u64;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                    let state = registry_app.state::<AppState>();
                    // A launch is a state event, but not always a reason to
                    // talk to the registry: a registration from this install
                    // that is still fresh means the record is already there.
                    // That is what keeps a person who reopens the app twenty
                    // times a day from paying twenty registrations.
                    if commands::registry::registered_recently(&state).await {
                        delay = commands::registry::REGISTRATION_FRESH_SECONDS;
                        continue;
                    }
                    match commands::registry::register_this_device(&state).await {
                        Ok(Some(record)) => {
                            tracing::info!(number = ?record.number, "registered this computer with the registry");
                            // Keep-alive, well inside the registry's seven-day
                            // sweep. Sleep/suspend can stretch it; the next
                            // launch registers immediately anyway.
                            delay = commands::registry::REGISTRATION_FRESH_SECONDS;
                        }
                        Ok(None) => {
                            // Auto-registration is off. No network request was
                            // made; this only re-reads the local setting, so a
                            // short delay is cheap and switching it on takes
                            // effect without a restart.
                            delay = 60 * 60;
                        }
                        Err(error) => {
                            tracing::warn!(%error, "the registry did not register this computer; retrying");
                            delay = (delay * 2).min(300);
                        }
                    }
                }
            });
            // Boundary's lasting helper identity, and saving computers that
            // pair this helper, so they appear in the Library to reopen.
            commands::boundary::install(app.handle(), &boundary_dir);
            // Get help: sharing this computer, and unattended access when
            // the person switched it on.
            commands::support::install(app.handle());
            commands::support::migrate_autostart();
            // Started at sign in for unattended access: out of the way until
            // a helper connects, when the window comes forward to say so.
            if std::env::args().any(|a| a == boundary_provision::autostart::BACKGROUND) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.minimize();
                }
            }
            // File-transfer sidecars live in their own managed state so the
            // SFTP registry stays independent of the session registry
            // (PRD/08 §2.1).
            app.manage(files_state);
            // Remote shells. Separate registry again, but deliberately no
            // separate host-key store: `SshState` borrows `FilesState`'s, so
            // trusting a machine once covers its terminal, its Files panel
            // and its RFB tunnel alike.
            app.manage(commands::ssh::SshState::new());
            // Native shortcut capture (PRD/06 §3 Tier 2). Constructing the
            // backend installs nothing and prompts for nothing, capture is
            // strictly opt-in, per session, from the toolbar toggle.
            app.manage(Arc::new(commands::capture::CaptureState::new(app.handle())));

            menu::install(app.handle())?;
            // The tray is a convenience, not a requirement. A Linux desktop
            // with no StatusNotifier, or a build with no icon, used to take
            // the whole application down with it, because the failure was
            // fatal. The app without a tray is still a perfectly good app.
            if let Err(error) = tray::install(app.handle()) {
                tracing::warn!(error = %error, "the tray could not be built; the app runs without one");
            }

            // The agent plane, if a person has switched it on. With the
            // setting off this binds nothing, spawns nothing and creates no
            // file, which is what `AGENT_BRIEF` D2 and `00 R40` require of an
            // ordinary install.
            commands::agent::install(app.handle());

            // Escape hatch (PRD/06 §3): force-release capture from anywhere.
            // A stuck grab that swallows the keyboard is unforgivable, so this
            // is registered up front and never unregistered.
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let release = Shortcut::new(
                    Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
                    Code::Escape,
                );
                if let Err(e) = app.global_shortcut().register(release) {
                    // Non-fatal: another app may already own the combo. Capture
                    // still auto-releases on blur/close/exit, and the toolbar
                    // toggle still works.
                    tracing::warn!("could not register the capture release hotkey: {e}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // Closing a session window cancels its session(s) so the socket
                // sends a clean RFB close (PRD/01 §6).
                // Every hook here is keyed on what the window actually OWNS,
                // not on its label. A session used to imply a window called
                // `session-<id>`, but in tabbed view sessions live in `main`
                // alongside the library, so `main` closing has to tear its
                // sessions down exactly the way a session window does. Each
                // call is a no-op for a window that owns nothing, which is what
                // `main` is in the one-window-per-session mode.
                tauri::WindowEvent::CloseRequested { .. } => {
                    // Release the keyboard FIRST: whatever else fails, the user
                    // must not be left with a grab held by a window that is
                    // going away.
                    //
                    // The SESSIONS are not torn down here. `CloseRequested`
                    // fires BEFORE the webview can refuse the close, and the
                    // session view refuses it: it holds the close so it can
                    // take an exit thumbnail first, and the thumbnail needs
                    // the session to still be there. Tearing the session
                    // down at this point made the capture a race it always
                    // lost, and the thumbnail was silently dropped.
                    //
                    // The teardown happens on `Destroyed`, which is the moment
                    // the window is genuinely gone.
                    commands::capture::release_for_window(window.app_handle(), window.label());
                }
                // Capture is only ever held while the window that asked for it
                // is focused (PRD/06 §3). Blur disarms; focus re-arms if the
                // user still has pass-through switched on for that session.
                //
                // There is deliberately no "focus moved elsewhere, force
                // release" branch any more: the owning window's own blur event
                // already disarms, and with tabs the library and the session
                // share one window, so focusing it would have released the grab
                // the user had just asked for.
                tauri::WindowEvent::Focused(focused) => {
                    if *focused {
                        commands::capture::rearm_for_window(window.app_handle(), window.label());
                    } else {
                        commands::capture::disarm_for_window(window.app_handle(), window.label());
                    }
                }
                // A destroyed window can never re-arm, so drop the intent too.
                //
                // The teardown runs HERE and not on `CloseRequested`, because
                // this is the moment the window is genuinely gone: a window
                // can be destroyed without ever asking to close (the session
                // view calls `destroy()` when `close()` fails), and
                // `CloseRequested` never fires for a window that was destroyed
                // outright. Without this, the file-transfer queue and the
                // remote shell of a destroyed window stayed alive with no
                // window left to show them.
                tauri::WindowEvent::Destroyed => {
                    commands::capture::release_for_window(window.app_handle(), window.label());
                    shutdown_window(window);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_help_code,
            // hosts / library
            commands::hosts::list_hosts,
            commands::hosts::get_host,
            commands::hosts::save_host,
            commands::hosts::delete_host,
            commands::hosts::touch_connected,
            commands::hosts::list_groups,
            commands::hosts::save_group,
            commands::hosts::delete_group,
            commands::hosts::list_tags,
            commands::hosts::save_tag,
            commands::hosts::delete_tag,
            commands::hosts::set_host_tags,
            commands::hosts::set_hosts_group,
            commands::hosts::add_tag_to_hosts,
            commands::hosts::remove_tag_from_hosts,
            commands::hosts::list_history,
            commands::hosts::get_thumbnail,
            commands::about::about_info,
            commands::about::open_about_link,
            commands::hosts::get_app_setting,
            commands::hosts::set_app_setting,
            // native menu
            commands::menu::sync_session_menu,
            commands::menu::set_ui_language,
            // .rdp file import
            commands::rdpfile::import_rdp_file,
            commands::rdpfile::import_rdp_files,
            // credentials
            commands::credentials::save_password,
            commands::credentials::has_password,
            commands::credentials::set_has_password,
            commands::credentials::saved_user_names,
            commands::credentials::delete_password,
            commands::credentials::credential_backend,
            commands::credentials::unlock_credentials,
            // discovery
            commands::discovery::start_discovery,
            commands::discovery::stop_discovery,
            commands::discovery::scan_network,
            commands::discovery::deep_probe,
            commands::discovery::local_subnets,
            commands::discovery::wake_host,
            // sessions
            commands::session::connect_session,
            commands::boundary::connect_boundary,
            commands::boundary::boundary_provider_start,
            commands::boundary::boundary_provider_status,
            commands::boundary::boundary_provider_cancel,
            // device registry (optional; the app works without it)
            commands::registry::registry_health,
            commands::registry::registry_origin,
            commands::registry::registry_auto_register,
            commands::registry::registry_set_auto_register,
            commands::registry::registry_register_device,
            commands::registry::registry_register_helper,
            commands::registry::registry_create_code,
            commands::registry::registry_resolve_code,
            commands::registry::registry_lookup_number,
            commands::registry::machine_identity,
            commands::registry::registry_set_origin,
            commands::registry::registry_revoke_code,
            // get help (this computer shared over Boundary)
            commands::support::support_state,
            commands::support::support_refresh_displays,
            commands::support::support_set_display,
            commands::support::support_set_code_service,
            commands::support::support_share,
            commands::support::support_stop,
            commands::support::support_full_invitation,
            commands::support::support_answer,
            commands::support::support_answer_ask,
            commands::support::support_set_control,
            commands::support::support_set_tools,
            commands::support::support_pair,
            commands::support::support_set_unattended,
            commands::support::support_set_helper,
            commands::support::support_remove_helper,
            commands::support::support_set_password,
            commands::support::support_set_autostart,
            commands::support::support_end_unattended,
            commands::support::support_stop_unattended_tools,
            commands::support::support_request_screen_permission,
            commands::support::support_open_input_settings,
            commands::support::support_open_time_settings,
            commands::support::support_save_network,
            commands::session::disconnect_session,
            commands::session::send_input,
            commands::session::trace_enabled,
            commands::session::trace_marks,
            commands::session::set_quality,
            commands::session::request_resize,
            commands::session::refresh_session,
            commands::session::set_view_only,
            commands::session::set_prefer_scancodes,
            commands::session::set_always_refresh,
            commands::session::send_clipboard,
            commands::session::set_local_clipboard,
            commands::session::read_local_clipboard,
            commands::session::reconnect_now,
            commands::session::release_all_keys,
            commands::session::capture_thumbnail,
            commands::session::trust_certificate,
            commands::session::forget_certificate,
            commands::session::provide_credentials,
            commands::session::cancel_credentials,
            commands::session::pending_credential_request,
            commands::session::boundary_permission,
            commands::session::open_session_window,
            commands::session::release_session_claim,
            commands::session::fullscreen_session,
            commands::session::list_active_sessions,
            // agent plane (dvvp.v1)
            commands::agent::agent_status,
            commands::agent::agent_take_the_wheel,
            commands::agent::agent_register_with_claude,
            commands::agent::agent_setup_agents,
            // file transfer (SFTP sidecar)
            commands::files::files_probe,
            commands::files::files_connect,
            commands::files::files_disconnect,
            commands::files::files_status,
            commands::files::files_home,
            commands::files::files_list,
            commands::files::files_mkdir,
            commands::files::files_remove,
            commands::files::files_rename,
            commands::files::files_upload,
            commands::files::files_download,
            commands::files::files_cancel,
            commands::files::files_local_home,
            commands::files::files_local_list,
            commands::files::files_local_grant_root,
            commands::files::files_pick_upload,
            commands::files::files_pick_download_dir,
            commands::files::files_local_mkdir,
            commands::files::files_local_rename,
            commands::files::files_local_remove,
            // remote shell (pty over the same ssh carrier)
            commands::ssh::ssh_probe,
            commands::ssh::ssh_list_local_keys,
            commands::ssh::ssh_list_wsl_distros,
            commands::ssh::ssh_connect,
            commands::ssh::ssh_send,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_reconnect_now,
            commands::ssh::ssh_disconnect,
            // native keyboard capture (shortcut pass-through)
            commands::capture::capture_start,
            commands::capture::capture_stop,
            commands::capture::capture_status,
            commands::capture::capture_permission_granted,
            commands::capture::capture_request_permission,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri application")
        .run(|app, event| {
            // The window-state plugin restores AFTER setup, so the clamp in
            // setup can see the pre-restore size. Ready is the first point at
            // which the real, restored window exists.
            if let RunEvent::Ready = event {
                if let Some(window) = app.get_webview_window("main") {
                    fit_main_window(&window);
                }
            }
            if let RunEvent::ExitRequested { .. } = event {
                // Release the keyboard before anything else can fail: the app
                // must never exit leaving a native hook installed.
                commands::capture::force_release(app);
                // Graceful shutdown: cancel every session, then give the
                // per-session tasks a beat to close their sockets cleanly.
                if let Some(state) = app.try_state::<AppState>() {
                    // The socket goes first: an agent that reconnects to a
                    // path the application no longer serves gets a refusal,
                    // and an agent that finds the file still there while the
                    // sessions are being torn down gets a limb that dies under
                    // it.
                    agent::stop(&state.agent);
                    state.shutdown_all_sessions();
                    state.discovery.cancel_all();
                }
                if let Some(files) = app.try_state::<commands::files::FilesState>() {
                    files.shutdown_all();
                }
                if let Some(ssh) = app.try_state::<commands::ssh::SshState>() {
                    ssh.shutdown_all();
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });
}

#[cfg(test)]
mod tests {
    use super::help_code_from_url;

    #[test]
    fn reads_the_help_links_the_app_shares() {
        assert_eq!(
            help_code_from_url("oraxdesk://join/123456789012").as_deref(),
            Some("123456789012")
        );
        assert_eq!(
            help_code_from_url("oraxdesk://help?code=123456789012").as_deref(),
            Some("123456789012")
        );
        assert_eq!(
            help_code_from_url("oraxdesk://help/123456789012").as_deref(),
            Some("123456789012")
        );
    }

    #[test]
    fn ignores_links_that_are_not_help_links() {
        assert_eq!(help_code_from_url("https://example.com/join/123"), None);
        assert_eq!(help_code_from_url("oraxdesk://settings"), None);
        assert_eq!(help_code_from_url("oraxdesk://join/"), None);
    }
}
