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

## Recommended order

1. **Harden the job runner** (persistence, caps, cancel verification, CLI) —
   small, and everything else sits on it.
2. **Support inbox** — independent of the agent path, immediately useful to the
   operator, and it makes the "sent me a number" workflow one click.
3. **Runbooks** — the largest piece, and the one that needs 1 to be solid.

Cross-cutting: keep the free-tier request budget in the design (refresh on
open, no background polling), keep every remote byte marked as remote text in
the UI and in logs, and keep the host's consent as the only gate for `exec`.
