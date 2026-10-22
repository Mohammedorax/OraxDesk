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
//!
//! The two read the same two files, so they read them the same way. The
//! parsing below is `build.rs`'s parsing, kept identical to it, because the
//! blind spot it had was invisible to both of them at once: a command
//! registered by its bare name was in the handler block, but a parser that
//! kept only the entries containing `::` never saw it, so it was in no
//! manifest and in no capability, and the build was green.

use std::collections::BTreeSet;

/// The marker that opens the command list in `build.rs`.
///
/// Assembled from parts, for the same reason as in `build.rs`: the source
/// of the function that looks for it must not contain the literal, or the
/// search would find that line first and read the wrong list.
const MANIFEST_MARKER: &str = concat!("AppManifest::new()", ".commands(&[");

/// The lines between an opening marker and the line that closes it.
///
/// The block is found line by line, so a marker that also appears inside a
/// string elsewhere in the file cannot open it in the wrong place, and the
/// closing line is found by its shape rather than by a search for a closing
/// bracket, so a comment in the middle of a list cannot end it early.
///
/// This is `build.rs`'s `block_lines`, kept byte for byte identical to it.
/// The two read the same files and have to reach the same answer about
/// them: the build script refuses the build on what this file says, and a
/// difference between the two is a difference in what gets refused.
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

/// The command name in one entry of the `generate_handler!` block.
///
/// `None` for a comment or a blank line. A PANIC for an entry that is not a
/// command name: an entry this cannot read is a command the check cannot
/// see, and a command the check cannot see is the failure the check exists
/// to catch, so it stops the build instead of passing quietly.
///
/// This is `build.rs`'s `command_name`, kept byte for byte identical to it,
/// down to the message, so that the build script and this test fail on the
/// same entry for the same reason.
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

fn read(path: &str) -> String {
    let root = env!("CARGO_MANIFEST_DIR");
    std::fs::read_to_string(format!("{root}/{path}")).expect(path)
}

/// The command names in `generate_handler![...]`.
///
/// EVERY entry in the block is a command. The block holds path-qualified
/// names (`commands::hosts::list_hosts`), but a command can also be
/// registered by its BARE name, and a filter that kept only the entries
/// containing `::` made those invisible: the command was registered, no
/// permission was generated for it, no grant existed, and the build was
/// green. That is exactly the failure this check exists to catch, so the
/// last `::` segment is taken when the entry has a path and the whole entry
/// when it has none.
fn registered() -> BTreeSet<String> {
    block_lines(&read("src/lib.rs"), "generate_handler![")
        .into_iter()
        .filter_map(|l| command_name(&l))
        .collect()
}

/// The command names `build.rs` puts in the app manifest.
fn manifest() -> BTreeSet<String> {
    block_lines(&read("build.rs"), MANIFEST_MARKER)
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

/// A command registered by its bare name is a command.
///
/// The blind spot this covers was invisible to every check: the name was in
/// the handler block, but a parser that only kept the entries containing
/// `::` never saw it, so it was in no manifest and in no capability, and
/// Tauri refused every call to it at run time with "not allowed by ACL".
#[test]
fn a_bare_name_is_a_command() {
    assert_eq!(command_name("list_hosts,").as_deref(), Some("list_hosts"));
    assert_eq!(
        command_name("commands::hosts::list_hosts,").as_deref(),
        Some("list_hosts")
    );
    assert_eq!(command_name("list_hosts").as_deref(), Some("list_hosts"));
}

/// A comment and a blank line are not commands.
#[test]
fn a_comment_is_not_a_command() {
    assert_eq!(command_name("// hosts / library"), None);
    assert_eq!(command_name("   "), None);
    assert_eq!(command_name(""), None);
}

/// An entry that is not a command name stops the check.
///
/// It used to be skipped, and a skipped entry is a command nothing knows
/// about: registered, undeclared, ungranted, and invisible.
#[test]
#[should_panic(expected = "is not a command name")]
fn a_malformed_entry_stops_the_check() {
    let _ = command_name("not a command,");
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
