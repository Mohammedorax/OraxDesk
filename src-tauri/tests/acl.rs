//! Every command the app registers has to be granted, or Tauri refuses it at
//! run time with "not allowed by ACL" and the UI quietly gets nothing back.
//! That happened twice (`boundary_permission`, `agent_setup_agents`) and once
//! with the whole device registry, whose eight commands were registered in
//! `generate_handler!` but never declared in the app manifest, so no
//! `allow-registry-*` permission was ever generated and the feature was dead
//! in the shipped app while looking alive in the source.
//!
//! `src-tauri/build.rs` enforces the same invariant at build time, so a
//! broken grant cannot reach a build. This test says the same thing with a
//! better error message, and adds the two directions the build script does
//! not check: a grant for a command nothing answers, and a grant that leaked
//! into the session window's capability.

use std::collections::BTreeSet;

/// The lines between an opening marker and the line that closes it.
///
/// The closing line is found by its shape rather than by a search for a
/// closing bracket, so a comment in the middle of a list cannot end it early.
fn block_lines(text: &str, marker: &str) -> Vec<String> {
    let Some(start) = text.find(marker) else {
        return Vec::new();
    };
    let rest = &text[start + marker.len()..];
    let mut lines = Vec::new();
    for line in rest.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("])") {
            break;
        }
        lines.push(trimmed.to_string());
    }
    lines
}

fn read(path: &str) -> String {
    let root = env!("CARGO_MANIFEST_DIR");
    std::fs::read_to_string(format!("{root}/{path}")).expect(path)
}

/// The command names in `generate_handler![...]`.
fn registered() -> BTreeSet<String> {
    block_lines(&read("src/lib.rs"), "generate_handler![")
        .into_iter()
        .filter(|l| l.contains("::"))
        .filter_map(|l| {
            l.trim_end_matches(',')
                .rsplit("::")
                .next()
                .map(str::to_string)
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// The command names `build.rs` puts in the app manifest.
fn manifest() -> BTreeSet<String> {
    block_lines(&read("build.rs"), "AppManifest::new().commands(&[")
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

#[test]
fn every_registered_command_is_in_the_manifest() {
    let missing: Vec<_> = registered().difference(&manifest()).cloned().collect();
    assert!(
        missing.is_empty(),
        "add these to build.rs and a capability: {missing:?}"
    );
}

/// The other direction. A name in the manifest that no command answers would
/// generate a permission, be granted, and then fail at run time with "command
/// not found" instead of "not allowed by ACL", which reads like a missing
/// command rather than a typo in the grant.
#[test]
fn every_manifest_command_is_registered() {
    let missing: Vec<_> = manifest().difference(&registered()).cloned().collect();
    assert!(
        missing.is_empty(),
        "these are granted but nothing answers them: {missing:?}"
    );
}

#[test]
fn the_main_window_is_granted_every_command() {
    let default = read("capabilities/default.json");
    let missing: Vec<_> = manifest()
        .into_iter()
        .filter(|c| !default.contains(&format!("\"allow-{}\"", c.replace('_', "-"))))
        .collect();
    assert!(
        missing.is_empty(),
        "grant these in capabilities/default.json: {missing:?}"
    );
}

/// A session window is a viewer for one machine. It must not be able to
/// register this computer with the registry, mint a code, or read the machine
/// key, so those grants stay in the main window's capability.
#[test]
fn the_session_window_is_not_granted_the_registry() {
    let session = read("capabilities/session.json");
    for command in [
        "registry_health",
        "registry_register_device",
        "registry_register_helper",
        "registry_create_code",
        "registry_resolve_code",
        "registry_lookup_number",
        "registry_revoke_code",
        "machine_identity",
    ] {
        assert!(
            !session.contains(&format!("\"allow-{}\"", command.replace('_', "-"))),
            "{command} must stay out of capabilities/session.json"
        );
    }
}
