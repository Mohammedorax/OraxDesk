# Review: job runner, support inbox, runbooks

Scope: the three pieces that turn "the operator pastes a number and drives a
screen" into a support product. This is a design review against the code as it
stands, not a wish list: every "exists" below points at a file.

## 1. Job runner

### What exists

- `dvv_job` (`crates/dvv/src/jobs.rs`, dispatched in
  `crates/dvv/src/mcp/server.rs`, declared in `crates/dvv/src/mcp/manifest.rs`):
  `start`, `status`, `log`, `cancel`, `list`.
- `start` builds a detached wrapper per platform: on Windows
  `start /B powershell -EncodedCommand <utf16-base64>` with the command itself
  base64 inside the script, so quoting cannot break across cmd → PowerShell →
  the command; on POSIX `nohup sh -c '...'` with single-quote escaping.
- Output and exit status land in `%LOCALAPPDATA%\OraxDesk\jobs\<id>.{log,err,status,pid}`
  (`/tmp/oraxdesk-jobs` elsewhere).
- `status` prints the code or `RUNNING`; `log` prints a tail (10–2000 lines);
  `cancel` kills the process tree (`taskkill /T /F`, `kill -TERM` then `-KILL`).
- Consent is unchanged: every call still needs the `exec` capability, which is
  in no role bundle, and the person at that machine can withdraw commands and
  files at any moment (`crates/boundary-session/src/tools.rs`).

### Gaps found in review

1. **The registry is in memory and per MCP process.** `static JOBS` lives in
   the `dvv` process. With the stdio transport that is one process per client
   session, so an agent that reconnects loses `list` and `status` for jobs it
   started — while the job itself keeps running. Fix: persist the table to
   `<data>/jobs.json` on every mutation and reload at start; the files are
   already the evidence.
2. **No ceiling.** Nothing caps the number of live jobs, the size of the log
   files, or how long a job's files stay. A support machine that runs a dozen
   installs accumulates gigabytes. Fix: cap live jobs (e.g. 32), rotate/size-cap
   the log (`-Tail` reads are fine, but the file grows), sweep finished jobs
   older than N days.
3. **Cancel does not verify.** `cancel` returns the shell's output; it does not
   re-read `status`. Fix: after `taskkill`, poll `status` once and report
   `still running` honestly instead of implying success.
4. **Platform is caller-declared.** `platform` defaults to `windows`; a macOS
   or Linux limb with the default produces a cmd-shaped string that `sh` cannot
   run, and the error is a shell syntax error rather than "wrong platform".
   Fix: resolve the platform from the limb's own reported OS where the plane
   knows it, and refuse a mismatch.
5. **No CLI verb.** `dvv run` exists; `dvv job ...` does not
   (`crates/dvv/src/cli.rs`), so shell-driven agents have no way in.
6. **Tests are unit-only.** The wrappers, the quoting, the read commands and
   the registry are covered; the round trip (start → poll → log → cancel)
   against a real limb is not. It should be one integration test behind a
   feature flag, since it needs a session.

Effort: one session for 1–3 and 5; 4 is a small plane change; 6 is a test
harness. All of it is contained — no protocol change.

## 2. Support inbox

### What exists

Nothing in the app. The operator receives a number out of band (a message) and
pastes it into "a computer I can reach" (`ui/src/components/BoundaryConnect.tsx`),
which resolves it and saves a host.

The data needed for a status column already exists:

- `GET /v1/devices/by-number/<number>` — unauthenticated, rate limited
  (`cloudflare/src/index.ts:56`), returns `id`, `version`, `last_seen_at`,
  `revoked_at`.
- `GET /v1/devices/<id>/address` — 404 unless the machine published an address
  in the last hour (`ADDRESS_TTL_SECONDS = 3600`, `cloudflare/src/directory.ts`).

So "online / no address / revoked / unknown" is derivable without a new
endpoint, with one caveat: `last_seen_at` is the device's registration
keep-alive (48 h), not liveness, and an address is "reachable-ish", not "awake".

### Design

- New table `support_inbox(id, number, note, added_at, last_checked_at,
  last_state, host_id)` in the existing SQLite store, so the list survives
  restarts and the profile it resolved to is remembered.
- Tauri commands: `inbox_add(number, note)`, `inbox_list()`, `inbox_remove(id)`,
  `inbox_refresh()` (one pass over the list, one request per row, sequential
  with a small delay — the Worker rate-limits by IP and the free plan is
  100k requests/day, see the capacity note).
- One-click connect reuses the existing `connect_session` with
  `protocol: "boundary"` and the resolved id; it must not create a duplicate
  host when the same machine is already saved.
- UI: a left-panel screen (same shape as the Library list) with a state chip
  per row and a toolbar "add number". No polling while the screen is closed;
  refresh on open and on a button, which keeps the request budget predictable.

### Risks

- **Polling cost.** A list of 50 rows refreshed every 30 s is 144k requests/day
  — over the free 100k. Refresh on open, and cap the list (e.g. 200 rows).
- **Truthfulness.** "No address" is a fact; "offline" is not. The chip must say
  "not published" and the tooltip must name the fix (turn on Unattended
  access), which is the same sentence the connect path now produces.
- **Privacy.** A number is an identifier the operator already has; the inbox
  adds notes. Those notes are local and must not be sent to the Worker.

Effort: two to three sessions (schema + commands + screen + tests). No protocol
change.

## 3. Runbooks

### What exists

`docs/RUNBOOKS.md`: the recipes for Office (ODT), MSI packages, SQL Server,
database restore, preflight and job hygiene. They are prose and commands; there
is no library in the app and no button.

### The architectural question

The job table lives in the `dvv` process; the app's plane lives in the shell
(`src-tauri/src/agent/mod.rs`, `AgentPlane`). A "Run" button in the webview has
to reach one of them:

- **Through the plane (recommended).** Recipes are fixed templates compiled
  into the shell, not free text from the webview; the shell submits the same
  `Exec` intent the plane does, and the job table and its files are the ones
  `dvv_job` reads. This keeps one executor and one consent path, and means the
  webview can never run arbitrary text.
- **Through the MCP HTTP transport.** Reuses `dvv_job` as-is, but the shell
  needs the bearer token and the job table belongs to the sidecar process, so
  `list` and the UI's own state would disagree after a sidecar restart.

### Design

- `Runbook { id, name, platform, summary, steps: [Preflight | Install | Verify] }`
  compiled in Rust. Parameters are typed and narrow: a URL, a product id, a
  language, an instance name — never a free-form command.
- Secrets (the SQL `sa` password, a licence key) come from the OS keychain per
  run and are never stored in the recipe or logged; the job log must be
  redacted when printed.
- UI: Library sidebar → "Runbooks" → pick a machine → pick a recipe → fill the
  parameters → Run. The row shows state (running/exited), the exit code, and a
  tail of the log with a "follow" toggle; Cancel is the job's cancel.
- The elevation limit is part of the recipe's text: an installer that needs UAC
  stops, and the runbook says so before it starts instead of after.

### Risks

- Recipes rot: URLs change, versions go EOL (SQL Server 2014 is already out of
  support). Each recipe needs a version/URL field a person can edit.
- A runbook is a promise. A step that silently does nothing is worse than one
  that fails, so every step must end in a verification command whose output is
  shown.
- Long logs: the same size cap as the job runner.

Effort: three to four sessions (recipe model + executor + screen + two recipes
end to end + tests).

## 4. One SSH carrier for several sessions

Design only. Nothing below is implemented, and the present code is not wrong;
it is the conservative choice, and this section says what the other one costs.

### What exists

`crates/ssh-transport/src/tunnel.rs` is one `SshTunnel` per session. The
connector in `src-tauri/src/tunnel.rs` holds the only strong `Arc<SshTunnel>`,
inside that session's `ConnectOptions`, and each session opens its own
`direct-tcpip` channel from it. So two VNC panes through the same gateway are
two TCP connections, two authentications and two host-key checks against the
same pin store. Teardown rides drop, deliberately: the handle and every channel
keep the russh loop alive, so nothing is closed while a stream still reads it
(the comment at the end of `tunnel.rs` explains why a `close()` method was
deleted rather than fixed).

### Why share

- A gateway is usually one machine with one account, and an operator with six
  panes authenticates six times. With a passphrase-protected key, that is six
  prompts for one password.
- `MaxStartups` (10:30:100 by default) limits *unauthenticated* connections at
  once, so restoring a saved workspace of many tunnels after a gateway restart
  can be refused by the server before any of them authenticate.
- One keepalive window instead of six: a cable pull is noticed once, and every
  pane says "the carrier died" at the same moment rather than at six moments.

### Design

- A registry in the shell: `(user, gateway host, port, auth-identity,
  pin-store-id)` → `Weak<SshTunnel>`. A session upgrades or dials. The key
  carries the auth identity and the pin store, not just the endpoint — see the
  authority risk below.
- `SshTunnel` already takes `&self` and serialises redials under a tokio mutex,
  so the shared type needs no change; the registry is the new part.
- Channel accounting on the carrier: `sshd`'s `MaxSessions` (10 by default)
  counts channels per connection, not per session, so the carrier tracks what it
  has open and a session that would exceed it opens a second carrier instead of
  failing.
- Lifetime: the carrier lives while any session holds a channel or is between
  reconnects. The registry holds `Weak`, the sessions hold `Arc`, and nothing
  closes a carrier that still has a stream — the same rule drop already
  enforces, made explicit because a registry would otherwise be a way to break
  it.
- Log the channel open with the session id, so "which pane used the gateway"
  stays answerable.

### Risks

1. **One carrier is one failure domain.** Today a gateway blip kills one
   session; shared, it kills every session at once, and every supervisor
   re-dials through the same mutex. The mutex makes that correct but not fast:
   the first re-dial is the only one, and every other session waits for it. If
   it fails, they all fail together. That is a worse experience for the operator
   than six independent failures, and it must be a stated trade, not a surprise.
2. **Authority borrowing.** If the key is only the endpoint, a profile that
   failed to authenticate (or uses a different account) can join a carrier that
   already did, and inherit its identity. The key must include the exact auth
   identity, and a session that cannot authenticate must never enter a carrier it
   did not open.
3. **The channel budget moves.** `MaxSessions` is per connection, so sharing
   converts a per-session allowance into a per-gateway one: the eleventh pane
   fails with "administratively prohibited" where it works today. Either account
   for it and spill to a second carrier, or the feature reduces the number of
   panes a person can open.
4. **Host-key semantics split.** One verifier per carrier means one pin store's
   answer is applied to every session on it. Two profiles that reach the same
   gateway through different stores (work and personal, or a per-project store)
   would let one store's "known" cover the other's "changed". The store id in
   the key is what stops that; without it, sharing quietly weakens the one check
   that is allowed to hard-stop.
5. **Teardown becomes a policy, not a refcount.** With one owner, drop is
   complete and cannot fire early. With a registry, somebody has to decide when
   the last session has really gone, including a session parked in
   auto-reconnect; get it wrong and one pane's exit takes the others down,
   which looks exactly like a network drop and will be diagnosed as one.

### Why not now

The current guarantee is worth more than the saved authentications: no session
can affect another's transport, and a failure names one pane. Sharing is a
feature for an operator with many panes through one gateway, so it should land
with the accounting and the key above, not as a shortcut.

Effort: M (registry + key + accounting + tests). No protocol change.

## Recommended order

1. **Harden the job runner** (persistence, caps, cancel verification, CLI) —
   small, and everything else sits on it.
2. **Support inbox** — independent of the agent path, immediately useful to the
   operator, and it makes the "sent me a number" workflow one click.
3. **Runbooks** — the largest piece, and the one that needs 1 to be solid.

Cross-cutting: keep the free-tier request budget in the design (refresh on
open, no background polling), keep every remote byte marked as remote text in
the UI and in logs, and keep the host's consent as the only gate for `exec`.
