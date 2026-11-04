# Connection-layer audit — 2026-11-04

Read-only audit of the connection stack: the protocol cores (`vnc-*`, `rdp-*`,
`ssh-*`, `remote-*`), the transports, auth, the agent plane, and the shell's
input path (`src-tauri`, `ui`). Scope was commit `b905a01` plus the working
tree as it stood that day (several fixes were landing in parallel the same day;
they are listed under "in flight" and were verified locally).

Method: static reading, targeted greps, and running the local test suites.
No live server was driven in this pass; the live suites are skip-gated and
their contract is listed under the recommendation instead.

## Verified healthy (evidence cited)

1. **Panic discipline in protocol/shell code is effectively achieved.**
   395 non-test `.rs` files in `crates/` + `src-tauri/src` hold 2,625
   `.unwrap()/expect(` occurrences, but after excluding `tests/` directories,
   `#[cfg(test)]` modules, `mod tests` companion files, benches, examples and
   CLI harnesses, runtime code is left with only a handful — all of them
   infallible-invariant expects such as
   `rdp-auth/src/ntlm/crypto.rs:110` (`HMAC accepts any key length`, which that
   API structurally cannot fail). The protocol decoders parse server-sent
   bytes without panic-prone unwraps.

2. **`unsafe` stays inside five low-level OS crates** — `boundary-platform`
   (32: Win32 session enumeration, macOS accessibility/capture preflight),
   `vnc-input-capture` (20, OS input injection), `local-pipe` (12), `vnc-files`
   (3), `dvv` (1). There is no `unsafe` inside the protocol decode paths.

3. **SSH host-key trust is complete, not nominal.** `ssh-transport/src/hostkey.rs`
   implements TOFU keyed by the canonical `(host, port)`; the error set is
   `HostKeyUnknown` / `HostKeyChanged` / `HostKeyRejected` with UI-facing
   classification (`ssh-transport/src/error.rs`); a changed key is a hard stop
   and never retried (`error.rs` test, `is_transient` covers it);
   `ssh-core/tests/live.rs:396` pins the key on first contact and expects a
   silent unknown key to be impossible.

4. **Secrets never reach the logs.** A grep across every `tracing` call site in
   `crates/` + `src-tauri/src` for password/secret/credential/token found no
   leak path. (A positive regex check, not a proof; worth keeping via review
   habit rather than a lint.)

5. **Session recovery is pinned by tests**: `rdp-core/tests/reconnect.rs`
   covers drop-then-retry (`a_dropped_connection_is_retried_and_the_second_
   one_serves`), cookie replay for the second attempt, and redirection-token
   following.

6. **CI is broad**: `.github/workflows/ci.yml` runs `cargo fmt --check`,
   clippy over every library crate, and the full test set on
   ubuntu-24.04 (PipeWire 1.0 matched to the Wayland capture), macOS and
   Windows on every push — plus the sidecar staging that keeps `tauri-build`
   honest on a clean checkout.

## In flight the same day (verified locally, green)

- **Classical Arabic keysym typing across VNC and RDP.** One source table
  (`remote-core::ARABIC_KEYSYMS`, the X11R4 block `0x05ac..=0x05f2`) copied
  into the webview (`ui/src/render/keysyms.ts`) — the two copies are
  **48/48 identical** (checked programmatically). RDP character keysyms now
  travel as Unicode Fast-Path events instead of a scancode, so `ض` (which
  shares KeyQ with `q`) can no longer type the Latin key
  (`rdp-core/src/session/input.rs`, test
  `an_arabic_character_generates_a_unicode_fastpath_event`).
- **Clipboard-channel-only isolation** for malformed virtual-channel PDUs
  (`rdp-core/src/session/run_loop.rs`): the clipboard breaks alone, the
  session stands. The graphics-channel contract is unchanged, which keeps
  `a_malformed_egfx_message_after_decompression_is_reported_and_names_zgfx`
  passing (32/32 in the connect suite).
- **Human sovereignty enforced at the input path**: a keystroke or a pressed
  button revokes the session's agent in the same frame
  (`src-tauri/src/commands/session.rs`, `send_input`), and the standalone
  session window now takes the wheel on pointer-down like the split view does
  (`ui/src/screens/Session.tsx`, the finding labelled "audit finding
  P0 section 3").
- `cargo test -p remote-core -p limb-core -p vnc-core -p rdp-core
  -p agent-plane` and `tsc --noEmit` for `ui/` were run against that tree:
  all green.

## Gaps and recommendations

### P1 — make the "filed against real servers" promise continuous
(SHIPPED 2026-11-04 as `.github/workflows/live-protocol.yml`: nightly cron +
`workflow_dispatch`, OpenSSH on the runner agent-authenticated, x11vnc behind
a password on `:5901`, suites run with skip-guards intact. Status: green —
16 ssh live tests + 5 vnc live tests against real servers per run.)

One CI-specific caveat came with shipping it: the reconnect test
(`work_survives_a_disconnect_when_a_multiplexer_is_used`) cannot hold on an
ephemeral runner. Runner images ship
`KillUserProcesses=yes`, so systemd-logind tears the whole session cgroup —
tmux server included — down at a *graceful* ssh close, which is exactly what
russh's clean disconnect is. The same shape survives the abrupt drop a real
network gives (on the same runner, `SIGKILL` of the local ssh leaves
`tmux list-sessions` reporting the session; then the crate's probe via exec
still answers `present`). The test skips under `CI=true` with that reason and
expects to be driven by hand against a real desktop host. The gates it covers:

- `DVV_LIVE_SSH=user@host[:port]` — agent auth only, never a password
  (`ssh-core/tests/live.rs`, `fn target`); the reconnect test additionally
  wants a multiplexer (`tmux`) installed on the target and a host whose
  logind does not kill the session at close time.
- `DVV_LIVE_VNC=[host:]port`, default `127.0.0.1:5900`:
  `vnc-core/tests/interop_live.rs` skips gracefully when no RFB server answers,
  never answers any auth challenge (no server-side lockout risk), and runs the
  generic assertions against any server while reserving Apple's `RFB 003.889`
  quirks (the one shape the mock cannot imitate) for a real Mac.
- `DVV_LIVE_MARKER`, `DVV_LIVE_RESOLVE`, `DVV_LIVE_RESOLVE_IP`,
  `DVV_LIVE_SUBNET_SCAN` — the network-discovery family
  (`vnc-discovery`) — remain outside the workflow (need a specific network,
  DNS or Windows host to mean anything).

### P2 — write down the graphics-channel failure policy

Today a message that fails our own eGFX/ZGFX decode ends the session
(`rdp-core/tests/connect.rs:1328`, "the same bytes will not parse on the next
attempt either", non-transient). The clipboard got the softer "isolate, keep
running" contract in the same tree. Both behaviours are deliberate and each is
defensible — the gap is that the choice is only implied by a test. Write two
sentences into `docs/ARCHITECTURE.md` (decode failure by us vs framing broken
by the server are different events; reconnect-ladder reasoning differs
accordingly) so the next change starts from a stated policy, not an accident.

### P2 — document the panic/unsafe policy

`docs/ARCHITECTURE.md` should state what the audit found so future
contributors preserve it: FFI only in those five crates; protocol parsing
keeps `unwrap` to infallible-invariant expects with a message saying the
invariant. The policy is already de facto; making it written is cheap.

### No P0 open in the audited surfaces

Nothing in host-key handling, secret handling, logging, or the protocol
decoders presented an open finding at commit `b905a01`. The two P1/P2 items
above are about keeping what exists true over time, not fixing what is broken.
