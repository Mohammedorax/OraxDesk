# Improvement plan

A working plan, ordered by dependency rather than taste. Every item says what
is actually wrong or missing, what "done" looks like (something a person can
check), and what it costs. Where an item needs a decision, a key or a machine
that this repository cannot supply, that is written down instead of assumed.

Effort: **S** is one session, **M** is two to four, **L** is a week or more.

## Where this stands (2026-11-04)

- **Windows** is the only platform whose bundle has been installed and checked:
  0.31.9, with the installed `dvv.exe` hash compared to the built one after
  every install, the app launched, closed and its log confirmed to grow.
- **Linux and macOS have never been built successfully.** CI has been red since
  1 November for four independent reasons (rustfmt, an RGB icon that Tauri
  refuses on macOS, a macOS-only `mut`, and PipeWire headers older than
  `libspa` reads). Those are fixed; the first honest Linux/macOS build is
  still ahead.
- **The agent plane** now has explicit capabilities, a bounded and cancellable
  `Wait`, a driving badge that observes instead of believing, an `exec`
  consent gate, and a shell that serves a long command without freezing every
  other tool call.
- **`linux.yml` has never run**; neither has the updater, because there is no
  signing key.

## Principles

1. **A fix is not done until something fails if it regresses.** Tests are for
   the claim, not for the diff.
2. **Fail closed on anything that grants authority.** An unreadable setting,
   an unknown value and a missing row all mean "no".
3. **A claim the code cannot support is removed, not softened.** This is why
   the badge stopped saying "a person took the wheel" for an expired lease.
4. **Build on the platform you ship to.** Cross-building Linux from Windows is
   not a shortcut, it is a different bug.

---

## Track 1 — Release integrity (P0, blocks everything else)

### 1.1 CI green on all three platforms
**State:** green on 4 November for the first time: rustfmt, clippy with
`-D warnings`, every crate's tests and the app's tests on ubuntu-24.04, macOS
and Windows, plus the frontend, the Worker, the audit and `Agents end to end`
(macOS app, Linux deb, Linux AppImage). Getting there took five fixes, all of
them things a local Windows build could not show: rustfmt drift, an RGB icon
that Tauri refuses on macOS, a macOS-only `mut` that had never been compiled,
PipeWire headers older than `libspa` reads, and a sidecar the app's build
script requires that CI never staged.
**Done when:** it stays green for five consecutive pushes.
**Effort:** S (watch it).

### 1.2 The Linux bundles exist and install
**State:** the workflow ran for the first time on 4 November and produced
`OraxDesk_0.31.9_amd64.deb`, `OraxDesk-0.31.9-1.x86_64.rpm` and
`OraxDesk_0.31.9_amd64.AppImage` (144 MB, magic numbers checked: ar archive,
rpm header, ELF). Nothing has been **installed** from them yet.
**Done when:** the **rpm installs on Fedora**, the app opens, a VNC session
connects, and the agent panel works. The AppImage runs from a folder that is
not the source tree.
**Effort:** S now (a VM and an hour). **Blocked by:** a Fedora machine.
**Why it is not optional:** Fedora is the stated target.

### 1.3 macOS bundle builds and launches
**State:** the `macOS (app)` job in `Agents end to end` passes: the app bundles
at 74.5 MiB (debug), installs, and drives a machine with the app closed.
**Remaining:** a locally built `.app` opened by hand, with no console errors on
first run — CI proves it launches and works, not that it looks right.
**Effort:** S. **Blocked by:** a Mac.

### 1.4 The updater works end to end
**State:** there is no signing key, so no update has ever been produced or
applied; local builds pass `createUpdaterArtifacts: false` for that reason.
**Steps:** generate the key once, store it as a repository secret, publish a
signed `latest.json` plus artifacts, install version N, publish N+1, and let
the running app update itself on all three platforms.
**Done when:** the app reports the new version after an update, the installed
`dvv` hash changed, and a rollback to the previous installer still works.
**Effort:** M. **Blocked by:** the person holding the key — a decision, not
code.

### 1.5 Signing story for Windows and macOS
**State:** Windows is unsigned (SmartScreen warns); macOS signing scripts
exist and the secrets are documented in `docs/MACOS_SIGNING.md` but not set.
**Done when:** either the certificates are configured, or the release notes
state plainly what an unsigned download means and why it is acceptable for now.
**Effort:** S (documentation) / M (certificates). **Blocked by:** purchases.

---

## Track 2 — Authority and consent (P1, security)

### 2.1 A grant that a person approves, over hosts they name
**State:** `Plane::local` issues `Operator + Exec` over **every saved machine**
and says so in its own comment. `exec` is now gated by a person's answer, but
*which machines an agent may touch* is still "all of them".
**Change:** the shell mints a grant (capability set × host list) when a person
approves in the UI, writes it where only that user can read it, and passes its
path to `dvv`; `dvv` stops inventing one.
**Done when:** an agent opening a machine outside the granted list is refused
with a sentence naming the grant and the machines in it, and the approval
dialog lists the exact hosts rather than "your machines".
**Effort:** L. **Why P1:** this is the injection boundary (`09 §2`): a grant is
what stops "connect to the domain controller and run this" before the model's
decision reaches anything.

### 2.2 Per-capability consent, not just `exec`
**State:** `hello` still grants `asked ∩ GRANTED` with no human in the loop for
`files.write`, `capture` or `control`. Only `exec` has a prompt.
**Decision needed:** one "this agent may do X on these machines" dialog that
covers the whole requested set (recommended), or a prompt per capability the
first time it is used (noisier, finer).
**Done when:** no capability that reaches a screen, a disk or a shell is held
by a connection whose grant a person has not seen.
**Effort:** M. **Depends on:** 2.1, because both are the same dialog.

### 2.3 SSH carrier sharing
**State:** design and five risks in `docs/REVIEW-SUPPORT.md` §4; not built.
**Done when:** the registry is keyed by endpoint **plus auth identity plus pin
store**, `MaxSessions` is accounted per carrier, and a test proves that a
failed authentication cannot join a carrier another identity opened.
**Effort:** M. **Deliberately not first:** one carrier per session is the safer
default and costs only repeated authentications.

### 2.4 Revocation durability
**Done when:** a revoked agent cannot reattach without a person, a crash does
not leave a lease held, and two agents racing for one limb produce one winner
and one named refusal. Most of this exists; the missing piece is the test that
runs it twice.

---

## Track 3 — Things we claim but have not measured (P1)

These are all "the code says X; nobody has watched X happen".

| Item | What it would take | Effort |
|---|---|---|
| VNC against a real server (TigerVNC/RealVNC/UltraVNC) | enable `sshd`/a VNC server, run the field matrix | M |
| RDP against a real Windows host | enable `TermService` on a second machine | M |
| Relay and cable-pull | a second machine, then pull the cable mid-session | M |
| The 65 s Windows keepalive | a packet capture over an idle session | S |
| iroh dead-peer semantics | two devices, one suspended | S |
| Unix-socket `dvv` tests | they exist and are `cfg(unix)`; they need Linux CI | S |

**Blocked by:** the first four change the machine they run on, or need a second
one. Ask before starting.

---

## Track 4 — Product and interface (P2)

1. **Agent panel becomes an authority view.** Today it shows connection state
   and the consent switch. It should show, per agent: what it may do, on which
   machines, and what it is doing now. **M**, depends on 2.1.
2. **Inbox becomes a workflow.** A number arrives; the next step is one click
   to open that machine with the stored credential, and one to tag it. **S.**
3. **Runbooks execute from the app.** The design exists (`REVIEW-SUPPORT.md`
   §3) with one consent path and no free-text commands. **M.**
4. **Onboarding for invitations.** The re-invite path exists; measure how many
   people drop at "the code expired" and fix the copy, not the flow. **S.**
5. **Accessibility.** The canvas has no text alternative; focus order in RTL
   and the dialog traps deserve one pass with a screen reader. **M.**
6. **Arabic typography and numbers.** The interface is Arabic-first; check
   numerals, dates and plural forms in every screen against `Intl`. **S.**

---

## Track 5 — Performance and scale (P2)

1. **Library at a thousand hosts.** Virtualisation landed; measure open time,
   scroll frame time and memory at 305 (done) and 1000. **S.**
2. **The frame path has a budget nobody wrote down.** Measure decode, paint and
   encode per frame on a 4K screen, then either publish the numbers or make the
   adaptive quality respond to them. **M.**
3. **Agent perception cost.** A full screenshot is ~70 ms at native size; make
   damage-only the default for repeated looks and keep full frames for the
   first. **M.**
4. **Idle footprint and teardown.** Confirm that closing a session releases its
   decoder, its tunnel and its agent attachment within a second. **S.**

---

## Track 6 — Operations (P2)

1. **Diagnostics in one file.** The probes in `docs/DIAGNOSTICS.md` are
   separate tools; a single "collect" command that gathers logs, versions,
   hashes, network probes and the last session's events would turn a support
   conversation into one attachment. **M.**
2. **Registry operations.** Rate limits, a D1 backup schedule, and an operator
   runbook for revocation and abuse. **M.**
3. **Crash reporting, opt-in, no PII.** A panic in the Rust side is currently a
   silent exit for the user. **M** — and only with consent as the default.
4. **Backup and restore of the library** (not just the database file): export
   without secrets, import with a conflict rule. **S.**

---

## Track 7 — Quality gates (P3)

1. **Property tests for the wire codecs.** Hand-written cases exist; the
   encoders and decoders are where a byte count can be wrong only sometimes.
2. **Fuzzing for the three protocol parsers.** `cargo fuzz` targets for the VNC
   handshake, RDP PDU framing and the SSH key formats; a corpus checked in.
3. **A flake budget.** `Agents end to end` is a 30-minute job that fails for
   environmental reasons; quarantine it behind a label and make it required
   only on release tags, or it will be ignored within a month.
4. **Coverage, published.** Not as a gate — as a map of what has never run.

---

## What this plan deliberately does not do

- **Cross-build Linux from Windows.** It links WebKitGTK and the host CRT; a
  build script that pretends otherwise produces a binary that fails in a way
  nobody can debug.
- **Wildcards or inheritance in grants.** A grant's hosts are literal and fixed
  when a person approves it; that is the whole control.
- **Ack-based input ordering.** The release barrier was chosen and tested: drop
  only input at or below an admitted `ReleaseAllKeys`.
- **Auto-approving `exec` for convenience.** It is the one authority that is
  asked once and can be withdrawn at any time; that is the point.
- **A second writer for "who is driving".** Liveness is the connection row, not
  a clock and not a claim.

---

## Sequence

| Order | Items | Why this order |
|---|---|---|
| 1 | 1.1 → 1.2 → 1.3 | Nothing else can be trusted until the three platforms build |
| 2 | 1.4, 1.5 | A release without an update path is a download page |
| 3 | 2.1 + 2.2 | The largest remaining security gap, and one dialog covers both |
| 4 | 3 (table) | Turns claims into measurements; needs machines and permission |
| 5 | 4.1, 4.2, 6.1 | The work a person feels every day |
| 6 | 2.3, 5, 7 | Worth doing, not worth blocking on |

Every item is written so that the next session can pick it up without this
conversation: the state, the gap, the acceptance test and the blocker are in
the item itself.
