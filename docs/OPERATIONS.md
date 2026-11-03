# Operating limits (measured, not guessed)

Every number here came from a test or from the platform's documented behaviour,
and each one names what happens when it is reached. If a number changes, this
file changes with it; a limit nobody wrote down is a limit nobody plans for.

## Keepalive and dead-peer detection

| Platform | Idle | Interval | Probes | Window |
| --- | --- | --- | --- | --- |
| Windows | 15 s | 5 s | 10 (hardcoded since Vista) | **~65 s** |
| Linux / macOS | 15 s | 5 s | 3 (set by us) | **~30 s** |

`socket2` cannot set the probe count on Windows (`with_retries` is compiled out
there and `SIO_KEEPALIVE_VALS` carries only time and interval), so the Windows
number is not a choice this build can make. That is why the application-level
probes exist and matter more than the socket options:

- **VNC**: a 1×1 `FramebufferUpdateRequest` after 9 s of quiet; ten seconds
  without any answer ends the session as a timeout and the supervisor retries.
  A quiet desktop is healthy: it answers with a zero-rect update.
- **RDP**: a one-pixel `Refresh Rect` after one quiet tick (`PROBE_TIMEOUT`
  10 s), sent only when the server advertised `refreshRectSupport` and disabled
  for the session if the server answers with full repaints.

## SSH carriers

- **Authentication deadline**: the whole connect (KEX + auth), default 5 s,
  clamped 1–120 s. A server that completes KEX and ignores userauth fails; it
  does not hang.
- **Keepalive**: 5 s × 3 ≈ 15 s for an interactive/tunnelled carrier; 30 s × 3
  for the file sidecar, which is not watched by a human.
- **Input write deadline**: 20 s. A wedged write window can never wake on its
  own (it only wakes on `WINDOW_ADJUST`), so the timeout is the only exit.
- **Channels per connection**: OpenSSH's default `MaxSessions` is 10. A design
  that shares one carrier across sessions must budget channels or it will fail
  with "too many channels". This build dials one carrier per session, so the
  ceiling is the server's, not ours.

## Registry and directory

- **Free plan**: 100,000 Worker requests/day, 100,000 D1 rows written/day,
  5,000,000 rows read/day, 5 GB storage. Capacity at normal use is roughly
  5,000–8,000 devices active per day.
- **Number lookup**: unauthenticated, rate limited per client address.
- **Address publication**: TTL one hour. A stale address is treated as no
  address (`GET /v1/devices/{id}/address` returns 404).
- **Registration**: once at start plus a 48-hour keep-alive; `last_seen_at` is
  NOT liveness.

**A Worker cannot report the account's daily usage by itself.** The counter
lives in Cloudflare's analytics, not in the D1 database the Worker owns, so a
"70% of quota" alert needs the GraphQL Analytics API with an account-scoped
token. Until that exists, the honest answer is the one the inbox gives: one
explicit refresh, never a background poller.

## Local resources

- **Log file**: `%APPDATA%\com.deskvncviewer.desktop\logs\oraxdesk.log`,
  rotated at 5 MiB with one previous file. Maximum ~10 MiB on disk.
- **Job table**: 64 handles, forgotten after seven days. The files themselves
  are never deleted by the app.
- **Desktop prefs**: `prefs.hideToolbar` is repaired once per install so an
  older install starts visible; the repair marker is separate from the value,
  so a deliberate hide still sticks.

## What to watch before a pilot

1. Worker requests/day against the 100k ceiling.
2. Address publication rate — a machine that stops publishing is unreachable
   and the inbox will say "no address published", not "offline".
3. Log file growth on machines left running for weeks (rotation caps it; a
   machine that writes faster than 5 MiB/hour for weeks would cycle it).

## Building on this Windows machine

The MSVC tools under `Microsoft Visual Studio\18\Insiders` ship without
`msvcrt.lib`, `oldnames.lib` and `legacy_stdio_definitions.lib`. The build does
not need hand-made stubs: the Community 2022 toolset has the complete set, and
pointing `LIB` at it is enough.

```powershell
$msvc = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207\lib\x64"
$env:LIB = "$msvc;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\um\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\ucrt\x64"
$env:RUSTFLAGS = "-C target-feature=+crt-static"
cargo check --workspace --all-targets
```

Local builds also pass `--config` with `createUpdaterArtifacts: false` so no
updater signing key is needed; a release build must not use that override.
## Upgrading over a running sidecar

`dvv.exe` is installed by name, and Windows will not overwrite a running
executable. `dvv` stays resident: one holder per `dvv open`, one MCP server per
agent that spawned it. A silent (`/S`) or passive install therefore replaced
everything except `dvv.exe`, reported success, and left the OLD sidecar beside
the NEW application. The two halves are a protocol, so that mismatch presents
later as a tool answering wrongly rather than as an install that failed; it was
found on this machine by comparing the installed and built hashes after an
install that exited 0.

`src-tauri/windows/hooks.nsh` is the fix: `NSIS_HOOK_PREINSTALL` stops
`dvv.exe` by image name (both install locations, no elevation) before the files
are copied. An agent mid-task loses its MCP server and reconnects on its next
call; a stale sidecar is not recoverable that way.

After every install, compare the two hashes rather than trusting the exit code:

```powershell
(Get-FileHash "$env:LOCALAPPDATA\OraxDesk\dvv.exe").Hash
(Get-FileHash "target\release\dvv.exe").Hash
```

A mismatch means something held the file: check `Get-Process dvv` and reinstall.
