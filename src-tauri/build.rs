//! Build script: runs tauri-build and declares every application command in
//! the app ACL manifest so that `allow-<command>`/`deny-<command>` permissions
//! are generated and the capability files under `capabilities/` can grant them
//! per window (deny-by-default, PRD/01 §7).
//!
//! Also stamps the binary with its exact provenance (commit, tag, branch,
//! dirty state, toolchain) so the About dialog can fingerprint any build a
//! user reports from. Everything degrades to "unknown" when git or the
//! repository is absent (release tarballs), never to a build failure.

use std::process::Command;

/// Run `git <args>` in the workspace and return trimmed stdout, or None.
fn git(args: &[&str]) -> Option<String> {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").ok()?;
    let out = Command::new("git")
        .args(args)
        .current_dir(manifest)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// "clean" / "dirty", or None when git could not tell us.
///
/// Deliberately not routed through `git()`: that treats empty output as
/// failure, and `git status --porcelain` prints nothing precisely when the
/// tree is CLEAN. Every clean checkout, which is to say every release build,
/// therefore stamped "unknown" and the About dialog could not tell a pristine
/// build from an unknowable one.
fn git_dirty() -> Option<String> {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").ok()?;
    let out = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(manifest)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let clean = out.stdout.iter().all(|b| b.is_ascii_whitespace());
    Some(if clean { "clean" } else { "dirty" }.to_string())
}

fn stamp(key: &str, value: Option<String>) {
    println!(
        "cargo:rustc-env={key}={}",
        value.unwrap_or_else(|| "unknown".into())
    );
}

/// The marker that opens the command list in this file.
///
/// Assembled from parts, so that the source of the function that looks for it
/// does not itself contain it. Written out in full, the search would find
/// this very line first and read the wrong list.
const MANIFEST_MARKER: &str = concat!("AppManifest::new()", ".commands(&[");

/// The lines between an opening marker and the line that closes it.
///
/// The block is found line by line, so a marker that also appears inside a
/// string elsewhere in the file cannot open it in the wrong place, and the
/// closing line is found by its shape rather than by a search for a closing
/// bracket, so a comment in the middle of a list cannot end it early.
///
/// `tests/acl.rs` has this same function, kept identical to it: the two
/// read the same files and have to reach the same answer about them.
fn block_lines(text: &str, marker: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut inside = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if !inside {
            if !trimmed.contains(marker) {
                continue;
            }
            inside = true;
            let after = trimmed.split(marker).nth(1).unwrap_or("").trim();
            if !after.is_empty() {
                lines.push(after.to_string());
            }
            continue;
        }
        if trimmed.starts_with("])") {
            break;
        }
        lines.push(trimmed.to_string());
    }
    lines
}

/// The command names in `generate_handler![...]`, from `src/lib.rs`.
///
/// EVERY entry in the block is a command, and every one of them is read
/// here. The block holds path-qualified names (`commands::hosts::list_hosts`),
/// but a command can also be registered by its BARE name, and a filter that
/// kept only the entries containing `::` made those invisible: the command
/// was registered, no permission was generated for it, no grant existed, and
/// the build was green. That is exactly the failure this check exists to
/// catch, so the last `::` segment is taken when the entry has a path and
/// the whole entry when it has none.
fn registered_commands(lib: &str) -> Vec<String> {
    block_lines(lib, "generate_handler![")
        .into_iter()
        .filter_map(|l| command_name(&l))
        .collect()
}

/// The command name in one entry of the `generate_handler!` block.
///
/// `None` for a comment or a blank line. A PANIC for an entry that is not a
/// command name: an entry this cannot read is a command this check cannot
/// see, and a command it cannot see is the failure the check exists to
/// catch, so it stops the build instead of passing quietly.
///
/// `tests/acl.rs` has this same function, kept identical to it, down to the
/// message, so that the build script and the test fail on the same entry
/// for the same reason. The build script cannot use the test's crate and
/// the test cannot use the build script's, so the two copies have to be
/// kept in step by hand.
fn command_name(entry: &str) -> Option<String> {
    let entry = entry.trim().trim_end_matches(',').trim();
    if entry.is_empty() || entry.starts_with("//") {
        return None;
    }
    // A path-qualified name carries its module path in front of the
    // command, so the command is the LAST segment of it. An entry with no
    // path at all is the command.
    let name = entry.rsplit("::").next().unwrap_or(entry).trim();
    if name.is_empty() || !is_identifier(name) {
        panic!(
            "`generate_handler!` has an entry that is not a command name: {entry:?}. \
             Every entry in the block is a command, bare (`list_hosts`) or path-qualified \
             (`commands::hosts::list_hosts`), and the ACL check cannot see an entry it \
             cannot read."
        );
    }
    Some(name.to_string())
}

/// Whether `s` is a plain identifier, which is what a command name is.
fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_alphabetic() || first == '_') && chars.all(|c| c.is_alphanumeric() || c == '_')
}

/// The command names this build script puts in the app manifest.
fn manifest_commands(build: &str) -> Vec<String> {
    block_lines(build, MANIFEST_MARKER)
        .into_iter()
        .filter_map(|l| {
            let quoted = l.strip_prefix('"')?;
            match quoted.strip_suffix("\",") {
                Some(name) => Some(name.to_string()),
                None => quoted.strip_suffix('"').map(str::to_string),
            }
        })
        .collect()
}

/// Fails the build when a generated permission file has no command behind it.
///
/// `tauri-build` writes a permission file for every command in the manifest
/// and never deletes one, so a command that was renamed or removed leaves
/// its permission behind FOR EVER. The tree had one:
/// `agent_setup_agentsX`, for a command that does not exist, and it was
/// loaded into the shipped app's ACL as a grantable permission.
///
/// An orphan is a permission nobody can call and a file nobody will look at,
/// and there is no reason for it to be there. It is also a sign that a
/// command was renamed without anybody noticing, which is worth failing on.
///
/// This runs after `tauri_build::try_build`, because that is the only point
/// at which the files exist or have been refreshed.
fn check_no_orphan_permissions() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    println!("cargo:rerun-if-changed=permissions/autogenerated");
    let generated = format!("{dir}/permissions/autogenerated");
    let Ok(entries) = std::fs::read_dir(&generated) else {
        // No directory at all means no permissions, which the other check
        // has already complained about.
        return;
    };
    let build = std::fs::read_to_string(format!("{dir}/build.rs")).unwrap_or_default();
    let manifest = manifest_commands(&build);
    let mut orphans = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("toml") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // The files are named after the command, with the dashes kept.
        let command = stem.to_string();
        if !manifest.iter().any(|name| name == &command) {
            orphans.push(stem.to_string());
        }
    }
    if !orphans.is_empty() {
        orphans.sort();
        panic!(
            "these permission files have no command behind them: {}. \
             Delete them: tauri-build never removes one, so a renamed command leaves its permission behind.",
            orphans.join(", ")
        );
    }
}

/// Fails the build when the app's commands, the ACL manifest and the
/// capability file disagree.
///
/// Tauri refuses a command that is registered but not granted, with "not
/// allowed by ACL", and the webview only sees an empty answer. That happened
/// twice before (`boundary_permission`, `agent_setup_agents`) and once more
/// with the whole device registry, whose eight commands were registered in
/// `generate_handler!` but never declared here, so no `allow-registry-*`
/// permission was ever generated and the feature was dead in the shipped app
/// while looking alive in the source.
///
/// This lives in the build script rather than only in a test because the
/// build script runs for every build of the app, including the ones nobody
/// runs the test suite on. The test in `tests/acl.rs` says the same thing
/// with a better error message.
fn check_acl_is_complete() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    // The check reads three files, so a change to any of them has to bring
    // this build script back.
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=capabilities/default.json");
    let lib = std::fs::read_to_string(format!("{dir}/src/lib.rs")).unwrap_or_default();
    let build = std::fs::read_to_string(format!("{dir}/build.rs")).unwrap_or_default();
    let capability =
        std::fs::read_to_string(format!("{dir}/capabilities/default.json")).unwrap_or_default();

    let registered = registered_commands(&lib);
    let manifest = manifest_commands(&build);
    if registered.is_empty() || manifest.is_empty() {
        // The source could not be read or the shape changed. Say so rather
        // than passing a check that did not run.
        panic!(
            "could not read the command list out of src/lib.rs or build.rs; \
             the ACL check cannot run and the build is not trustworthy"
        );
    }

    let missing: Vec<_> = registered
        .iter()
        .filter(|c| !manifest.contains(c))
        .cloned()
        .collect();
    assert!(
        missing.is_empty(),
        "these commands are registered but not in the ACL manifest, so Tauri \
         will refuse every call to them at run time: {missing:?}\n\
         add them to the app manifest in build.rs"
    );

    let granted: Vec<_> = manifest
        .iter()
        .filter(|c| !capability.contains(&format!("\"allow-{}\"", c.replace('_', "-"))))
        .cloned()
        .collect();
    assert!(
        granted.is_empty(),
        "these commands are in the ACL manifest but no capability grants them, \
         so Tauri will refuse every call to them at run time: {granted:?}\n\
         add \"allow-<command>\" to capabilities/default.json"
    );
}

fn stamp_git_provenance() {
    // Re-stamp whenever the checked-out commit or the index changes, so the
    // hash and the dirty flag can never go stale in an incremental build.
    if let Some(git_dir) = git(&["rev-parse", "--absolute-git-dir"]) {
        println!("cargo:rerun-if-changed={git_dir}/HEAD");
        println!("cargo:rerun-if-changed={git_dir}/index");
    }

    stamp("DESKVNC_GIT_HASH", git(&["rev-parse", "HEAD"]));
    stamp(
        "DESKVNC_GIT_HASH_SHORT",
        git(&["rev-parse", "--short=9", "HEAD"]),
    );
    // The single most useful fingerprint: nearest tag, commits since it,
    // short hash, and a -dirty suffix when the tree had local edits.
    stamp(
        "DESKVNC_GIT_DESCRIBE",
        // `--abbrev=9` matches the `--short=9` hash above. Left at git's default
        // (7 on this repo), an untagged commit's describe carried a 7 char hash
        // that the about test could not find inside the 9 char one, so the
        // check only ever passed on a tagged release commit.
        git(&["describe", "--tags", "--always", "--dirty", "--abbrev=9"]),
    );
    stamp(
        "DESKVNC_GIT_BRANCH",
        git(&["rev-parse", "--abbrev-ref", "HEAD"]),
    );
    stamp(
        "DESKVNC_GIT_COMMIT_DATE",
        git(&["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d"]),
    );
    stamp("DESKVNC_GIT_DIRTY", git_dirty());
    stamp(
        "DESKVNC_RUSTC_VERSION",
        std::env::var("RUSTC")
            .ok()
            .and_then(|rustc| Command::new(rustc).arg("-V").output().ok())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()),
    );
    stamp("DESKVNC_BUILD_PROFILE", std::env::var("PROFILE").ok());
}

// The sidecar is staged before the app is compiled (see scripts/stage-sidecar.mjs):
// the app embeds it, so a sidecar staged afterwards is a sidecar that is
// too late.
fn main() {
    println!("cargo:rerun-if-env-changed=DESKVNC_REQUIRE_CLEAN");
    // The clean-tree requirement is checked FIRST, before this build writes
    // anything: it is about the tree as the person left it, and a tree a
    // person changed has to fail a release build whatever the build itself
    // goes on to do to it.
    if std::env::var_os("DESKVNC_REQUIRE_CLEAN").is_some() {
        assert_eq!(
            git_dirty().as_deref(),
            Some("clean"),
            "release source must be a clean git checkout: {}",
            git(&["status", "--short"]).unwrap_or_else(|| "git status unavailable".into())
        );
    }
    check_acl_is_complete();
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            // hosts / library
            "list_hosts",
            "get_host",
            "save_host",
            "delete_host",
            "touch_connected",
            // support inbox
            "inbox_add",
            "inbox_list",
            "inbox_remove",
            "inbox_refresh",
            "list_groups",
            "save_group",
            "delete_group",
            "list_tags",
            "save_tag",
            "delete_tag",
            "set_host_tags",
            // bulk counterparts, for a multi-selection dragged onto a group or
            // a tag in the Library
            "set_hosts_group",
            "add_tag_to_hosts",
            "remove_tag_from_hosts",
            "list_history",
            "get_thumbnail",
            "get_app_setting",
            "set_app_setting",
            // build/system fingerprint for the About dialog and bug reports
            "about_info",
            // the About dialog's two links, opened by the shell so the
            // webview never names a URL
            "open_about_link",
            // the native menu mirrors the session toolbar, so the webview has
            // to push it the state that toolbar would have shown
            "sync_session_menu",
            "set_ui_language",
            // `.rdp` file import. The webview sends a PATH and the shell
            // reads the file, so these are the only two new command names
            // this work adds and each is a grant to review on its own.
            "import_rdp_file",
            "import_rdp_files",
            // credentials (write/query only, passwords never flow back to JS)
            "save_password",
            "has_password",
            "set_has_password",
            "saved_user_names",
            "delete_password",
            "credential_backend",
            "unlock_credentials",
            // discovery
            "start_discovery",
            "stop_discovery",
            "scan_network",
            "deep_probe",
            "local_subnets",
            "wake_host",
            // sessions
            "connect_session",
            "connect_boundary",
            "boundary_permission",
            "boundary_provider_start",
            "boundary_provider_status",
            "boundary_provider_cancel",
            // Get help: sharing THIS computer. Granted to the main window
            // only. A session window has no business approving a helper or
            // switching on unattended access.
            "support_state",
            "support_refresh_displays",
            "support_set_display",
            "support_set_code_service",
            "support_share",
            "support_stop",
            "support_full_invitation",
            "support_answer",
            "support_answer_ask",
            "support_set_control",
            "support_set_tools",
            "support_pair",
            "support_set_unattended",
            "support_set_helper",
            "support_remove_helper",
            "support_set_password",
            "support_set_autostart",
            "support_end_unattended",
            "support_stop_unattended_tools",
            "support_request_screen_permission",
            "support_open_input_settings",
            "support_open_time_settings",
            "support_save_network",
            "take_pending_help_code",
            "disconnect_session",
            "send_input",
            "trace_enabled",
            "trace_marks",
            "set_quality",
            "request_resize",
            "refresh_session",
            "set_view_only",
            "set_always_refresh",
            "set_prefer_scancodes",
            "send_clipboard",
            // OS clipboard, natively. `navigator.clipboard` is gesture-gated in
            // the webview, so remote → local text can never land through it.
            "set_local_clipboard",
            "read_local_clipboard",
            "reconnect_now",
            "release_all_keys",
            "capture_thumbnail",
            "trust_certificate",
            "forget_certificate",
            // interactive auth prompt (PRD/10 §3.4), JS → Rust only; the
            // matching read direction deliberately does not exist.
            "provide_credentials",
            "cancel_credentials",
            "pending_credential_request",
            "open_session_window",
            "release_session_claim",
            "fullscreen_session",
            "list_active_sessions",
            // file transfer, SFTP sidecar (PRD/08). The fs plugin stays off;
            // local reads/writes go through these narrow commands and the
            // native dialog only.
            "files_probe",
            "files_connect",
            "files_disconnect",
            "files_status",
            "files_home",
            "files_list",
            "files_mkdir",
            "files_remove",
            "files_rename",
            "files_upload",
            "files_download",
            "files_cancel",
            "files_local_home",
            "files_local_list",
            "files_local_grant_root",
            "files_pick_upload",
            "files_pick_download_dir",
            "files_local_mkdir",
            "files_local_rename",
            "files_local_remove",
            // native keyboard capture, shortcut pass-through (PRD/06 §3
            // Tier 2). `capture_request_permission` is the only one that can
            // surface an OS prompt, so it stays a distinct, grantable command.
            "capture_start",
            "capture_stop",
            "capture_status",
            "capture_permission_granted",
            "capture_request_permission",
            // remote shell, a pty over the same SSH carrier as the sidecar.
            // `ssh_send` carries keystrokes, so it is as sensitive as
            // `send_input` and stays its own grantable command.
            "ssh_probe",
            // Reads the NAMES of the keys in `~/.ssh`, never their contents,
            // so the host editor can offer a list to choose from.
            "ssh_list_local_keys",
            "ssh_list_wsl_distros",
            "ssh_connect",
            "ssh_send",
            "ssh_resize",
            "ssh_reconnect_now",
            "ssh_disconnect",
            // The agent plane, as a person sees it. Neither of these reaches
            // the dvvp.v1 socket: `agent_status` reads what the shell already
            // knows so a pane can seed its badge on mount, and
            // `agent_take_the_wheel` is the revocation D5 promises needs no
            // application code anywhere else. They are two grantable commands
            // rather than one because reading who is driving and taking the
            // machine off them are different acts.
            "agent_status",
            "agent_take_the_wheel",
            // Registering the bundled `dvv` with Claude Code, which runs a
            // program on the person's behalf. Its own grant for that reason:
            // reading the plane's state and spawning a process are not the
            // same act.
            "agent_register_with_claude",
            // Writing the dvv entry into the config of each coding agent this
            // machine has, which is what the AI Agents panel's Set up button
            // runs.
            "agent_setup_agents",
            // The optional device registry (Cloudflare Worker + D1). Main
            // window only: a session window has no business registering this
            // computer, minting a code, or reading the machine's own number.
            //
            // These were registered in `generate_handler!` but missing here,
            // which means Tauri generated no `allow-registry-*` permission at
            // all, so every call was refused at run time with "not allowed by
            // ACL" and the whole feature was dead in the shipped app while
            // looking alive in the source. `src-tauri/tests/acl.rs` exists to
            // catch exactly that, but it is not in CI's test list.
            "registry_health",
            "registry_origin",
            "registry_auto_register",
            "registry_set_auto_register",
            "registry_set_origin",
            "registry_register_device",
            "registry_register_helper",
            "registry_create_code",
            "registry_resolve_code",
            "registry_lookup_number",
            "registry_revoke_code",
            // This computer's own endpoint id and nine-digit number. Derived
            // from the machine key on disk, no network.
            "machine_identity",
        ]),
    ))
    .expect("failed to run tauri-build");
    // The generated permission files are checked AFTER the build, because
    // that is the only point at which they exist or have been refreshed.
    //
    // `tauri-build` writes a permission file for every command in the
    // manifest and never deletes one, so a command that was renamed or
    // removed leaves its permission behind FOR EVER. The tree had one:
    // `agent_setup_agentsX`, for a command that does not exist, and it was
    // loaded into the shipped app's ACL as a grantable permission. An orphan
    // is a permission nobody can use and a file nobody will look at, and
    // there is no reason for it to be there.
    check_no_orphan_permissions();
    // The provenance stamp is taken LAST, after `tauri-build` has written the
    // permission files, because it describes the tree this build leaves
    // behind. `tauri-build` writes INTO the source tree
    // (`permissions/autogenerated/*.toml`), so a stamp taken before it
    // described a tree the build was about to change: a build that added a
    // command was stamped "clean" for a tree it had just made dirty, and the
    // About dialog reported a pristine build that was not one.
    //
    // Being last also means a FAILED build stamps nothing. The values are
    // handed to the compiler when this script ends, so a stamp printed
    // before a failure would be a provenance for a build that never
    // finished.
    stamp_git_provenance();
}
