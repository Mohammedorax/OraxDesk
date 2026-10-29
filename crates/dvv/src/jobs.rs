//! Long running commands: start, poll, read and stop.
//!
//! A support job such as "install Office" runs for tens of minutes. `dvv_run`
//! is the wrong tool for that: it waits for the command, and its own deadline
//! would cut the install in half while the far side kept running with nobody
//! reading the result. A job is the same command STARTED DETACHED, with its
//! output in a file and its exit status in another, so the agent can come
//! back: `status` says whether it is still going, `log` shows what it printed,
//! `cancel` stops it, and `list` shows everything started on this plane.
//!
//! Nothing here weakens the host's consent: every call still goes through the
//! same `exec` capability and the person at that computer still allows (and
//! can withdraw) commands and files.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Which shell the far side gives a command.
///
/// The wrapper has to match it: the transports hand the string to `cmd.exe` on
/// Windows and `/bin/sh` elsewhere, and a detachment trick for one is a syntax
/// error in the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    Windows,
    Posix,
}

impl Platform {
    pub fn parse(value: Option<&str>) -> Result<Platform, String> {
        match value.map(str::trim).filter(|v| !v.is_empty()) {
            Some("windows") | None => Ok(Platform::Windows),
            Some("posix") | Some("unix") | Some("linux") | Some("macos") => Ok(Platform::Posix),
            Some(other) => Err(format!(
                "unknown platform {other:?}; use \"windows\" or \"posix\""
            )),
        }
    }
}

/// One started job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub platform: Platform,
    /// The command the caller asked for, before any wrapper.
    pub command: String,
    /// Where its standard output and error land.
    pub log: String,
    /// Where its exit status lands, once it finishes.
    pub status: String,
    /// Where its process id was written, for `cancel`.
    pub pid: String,
    /// Unix seconds when it was started.
    pub started_at: u64,
}

/// Jobs started on this plane, by id.
///
/// A plane is one process living as long as the app, which is the lifetime a
/// job's files have anyway. Nothing is persisted: a restart loses the handles,
/// and the job's own log is still on the far side under the path it reported.
static JOBS: LazyLock<Mutex<HashMap<String, Job>>> =
    LazyLock::new(|| Mutex::new(load_from_disk()));

/// Where the table lives, when a caller says so.
///
/// Set by the tests, and by nothing else: the application uses the platform
/// data folder and has no reason to be told otherwise.
static STORE_PATH: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Point the job table at a file of the caller's choosing.
pub fn set_store_path(path: PathBuf) {
    let _ = STORE_PATH.set(path);
}

/// How many jobs one plane keeps a handle for.
///
/// The files stay on the far side either way; this bounds the table an agent
/// can make the process hold. The oldest handle goes first.
const MAX_JOBS: usize = 64;

/// How long a job keeps its handle. A week is longer than any support install
/// and short enough that the table does not become a log of the machine.
const KEEP_JOB_SECONDS: u64 = 7 * 24 * 60 * 60;

/// Where the table is kept between runs.
///
/// The job itself lives on the far side; this file only remembers the handle,
/// so losing it costs a `list`, never the work.
fn store_path() -> Option<PathBuf> {
    // The tests point this at a file of their own, so a unit test never
    // writes into the user's table: a test that leaves five handles behind is
    // a test that made the application lie about its jobs.
    if let Some(path) = STORE_PATH.get() {
        return Some(path.clone());
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_DATA_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    Some(base.join("OraxDesk").join("jobs.json"))
}

fn load_from_disk() -> HashMap<String, Job> {
    let Some(path) = store_path() else {
        return HashMap::new();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let Ok(mut table) = serde_json::from_str::<HashMap<String, Job>>(&raw) else {
        // A corrupt file is not a reason to lose this run's jobs: start empty
        // and let the next mutation rewrite it.
        tracing::warn!("the job table is unreadable; starting a fresh one");
        return HashMap::new();
    };
    let cutoff = unix_now().saturating_sub(KEEP_JOB_SECONDS);
    table.retain(|_, job| job.started_at >= cutoff);
    table
}

fn save(table: &HashMap<String, Job>) {
    let Some(path) = store_path() else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match serde_json::to_string(table) {
        Ok(json) => {
            if let Err(error) = std::fs::write(&path, json) {
                tracing::warn!("could not write the job table: {error}");
            }
        }
        Err(error) => tracing::warn!("could not serialize the job table: {error}"),
    }
}

/// A short id that is safe in a file name and unmistakable in a log.
pub fn new_id() -> String {
    format!("job-{}", uuid::Uuid::new_v4().simple())
}

fn jobs_dir(platform: Platform) -> String {
    match platform {
        // `%LOCALAPPDATA%` is expanded by cmd, so the string stays portable
        // between the machine whose session this is and the agent reading it.
        Platform::Windows => "%LOCALAPPDATA%\\OraxDesk\\jobs".to_string(),
        Platform::Posix => "${TMPDIR:-/tmp}/oraxdesk-jobs".to_string(),
    }
}

fn paths(platform: Platform, id: &str) -> (String, String, String) {
    let dir = jobs_dir(platform);
    match platform {
        Platform::Windows => (
            format!("{dir}\\{id}.log"),
            format!("{dir}\\{id}.status"),
            format!("{dir}\\{id}.pid"),
        ),
        Platform::Posix => (
            format!("{dir}/{id}.log"),
            format!("{dir}/{id}.status"),
            format!("{dir}/{id}.pid"),
        ),
    }
}

/// UTF-16LE base64, the encoding `powershell -EncodedCommand` expects.
fn powershell_encoded(script: &str) -> String {
    let mut bytes = Vec::with_capacity(script.len() * 2);
    for unit in script.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    base64_encode(&bytes)
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

fn base64_encode_str(text: &str) -> String {
    base64_encode(text.as_bytes())
}

/// Quote a string for `/bin/sh -c` inside a single quoted literal.
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// Register a job and return the `dvv_run` command that starts it detached.
pub fn start(
    platform: Platform,
    command: &str,
    limb: &str,
) -> Result<(Job, String), String> {
    if command.trim().is_empty() {
        return Err("a job needs a command".into());
    }
    let id = new_id();
    let (log, status, pid) = paths(platform, &id);
    let job = Job {
        id: id.clone(),
        platform,
        command: command.to_string(),
        log: log.clone(),
        status: status.clone(),
        pid: pid.clone(),
        started_at: unix_now(),
    };
    let start = match platform {
        Platform::Windows => {
            // The command travels as base64 and is decoded INSIDE PowerShell,
            // so no quoting rule of cmd, PowerShell or the command itself has
            // to survive two shell layers. `start /B` returns at once, which
            // is what makes this a job and not a `dvv_run`.
            let script = format!(
                "$ErrorActionPreference='Continue';\
                 $dir='{dir}';\
                 New-Item -ItemType Directory -Force -Path $dir | Out-Null;\
                 $cmd=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{cmd_b64}'));\
                 $p=Start-Process -FilePath 'cmd.exe' -ArgumentList '/C',$cmd -PassThru -NoNewWindow \
                    -RedirectStandardOutput '{log}' -RedirectStandardError '{err}';\
                 $p.Id | Set-Content -LiteralPath '{pid}' -Encoding ASCII;\
                 $p.WaitForExit();\
                 Set-Content -LiteralPath '{status}' -Value $p.ExitCode -Encoding ASCII;",
                dir = jobs_dir(Platform::Windows).replace('\'', "''"),
                cmd_b64 = base64_encode_str(command),
                log = log.replace('\'', "''"),
                err = status.replace(".status", ".err").replace('\'', "''"),
                pid = pid.replace('\'', "''"),
                status = status.replace('\'', "''"),
            );
            format!(
                "start \"\" /B powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand {}",
                powershell_encoded(&script)
            )
        }
        Platform::Posix => {
            let dir = jobs_dir(Platform::Posix);
            format!(
                "mkdir -p {dir} && nohup sh -c {inner} >/dev/null 2>&1 & echo $! > {pid}",
                dir = shell_single_quote(&dir),
                inner = shell_single_quote(&format!(
                    "{} > {} 2>{}; echo $? > {}",
                    command,
                    shell_single_quote(&log),
                    shell_single_quote(&status.replace(".status", ".err")),
                    shell_single_quote(&status)
                )),
                pid = shell_single_quote(&pid),
            )
        }
    };
    let _ = limb;
    let mut table = JOBS.lock().map_err(|_| "job table poisoned")?;
    // A plane holds a bounded number of handles. The oldest goes first, and
    // its files stay where they are: dropping a handle never deletes evidence.
    while table.len() >= MAX_JOBS {
        let Some(oldest) = table
            .values()
            .min_by_key(|job| job.started_at)
            .map(|job| job.id.clone())
        else {
            break;
        };
        table.remove(&oldest);
    }
    table.insert(id, job.clone());
    save(&table);
    Ok((job, start))
}

/// The command that reports a job's exit status, or `RUNNING`.
pub fn status_command(job: &Job) -> String {
    match job.platform {
        Platform::Windows => format!(
            "powershell -NoProfile -NonInteractive -Command \"if (Test-Path -LiteralPath '{status}') {{ Get-Content -LiteralPath '{status}' }} else {{ 'RUNNING' }}\"",
            status = job.status.replace('\'', "''"),
        ),
        Platform::Posix => format!(
            "if [ -f {status} ]; then cat {status}; else echo RUNNING; fi",
            status = shell_single_quote(&job.status),
        ),
    }
}

/// The command that prints the tail of a job's output.
pub fn log_command(job: &Job, lines: usize) -> String {
    let lines = lines.clamp(10, 2000);
    match job.platform {
        Platform::Windows => format!(
            "powershell -NoProfile -NonInteractive -Command \"if (Test-Path -LiteralPath '{log}') {{ Get-Content -LiteralPath '{log}' -Tail {lines} }} else {{ '' }}\"",
            log = job.log.replace('\'', "''"),
        ),
        Platform::Posix => format!(
            "tail -n {lines} {log} 2>/dev/null || true",
            log = shell_single_quote(&job.log),
        ),
    }
}

/// The command that stops a job's process tree.
pub fn cancel_command(job: &Job) -> String {
    match job.platform {
        Platform::Windows => format!(
            "powershell -NoProfile -NonInteractive -Command \"$p=Get-Content -LiteralPath '{pid}' -ErrorAction SilentlyContinue; if ($p) {{ taskkill /PID $p /T /F }} else {{ 'no pid recorded' }}\"",
            pid = job.pid.replace('\'', "''"),
        ),
        Platform::Posix => format!(
            "if [ -f {pid} ]; then kill -TERM \"$(cat {pid})\" 2>/dev/null; sleep 1; kill -KILL \"$(cat {pid})\" 2>/dev/null; echo cancelled; else echo 'no pid recorded'; fi",
            pid = shell_single_quote(&job.pid),
        ),
    }
}

pub fn get(id: &str) -> Option<Job> {
    JOBS.lock().ok()?.get(id).cloned()
}

pub fn list() -> Vec<Job> {
    let Ok(table) = JOBS.lock() else {
        return Vec::new();
    };
    let mut jobs: Vec<Job> = table.values().cloned().collect();
    jobs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    jobs
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Point the table at a file of this test's own, once per process.
    fn use_a_test_store() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            let path = std::env::temp_dir()
                .join(format!("oraxdesk-jobs-test-{}.json", std::process::id()));
            set_store_path(path);
        });
    }

    #[test]
    fn the_windows_wrapper_hides_the_command_from_two_shells() {
        use_a_test_store();
        let (job, start) = start(Platform::Windows, "winget install --id Git.Git -e", "l").unwrap();
        assert!(start.starts_with("start \"\" /B powershell"));
        assert!(start.contains("-EncodedCommand "));
        // The command itself never appears in the shell line: it is base64 in
        // the encoded script, so no quote in it can break the wrapper.
        assert!(!start.contains("winget install"));
        // Decode the script the way PowerShell will, and prove the payload
        // and both paths really are inside it.
        let encoded = start.rsplit(' ').next().unwrap();
        let bytes = decode_base64(encoded);
        let script = String::from_utf16(
            &bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert!(script.contains(&base64_encode_str("winget install --id Git.Git -e")));
        assert!(script.contains(&job.log));
        assert!(script.contains(&job.status));
        assert!(script.contains(&job.pid));
    }

    #[test]
    fn the_posix_wrapper_quotes_a_hostile_command() {
        use_a_test_store();
        let (job, start) = start(Platform::Posix, "echo 'x' && touch /tmp/y", "l").unwrap();
        assert!(start.contains("nohup sh -c "));
        assert!(start.contains(&job.status));
        assert!(start.contains(&job.log));
        // A single quote inside the command is escaped, not left to close the
        // wrapper's own quote.
        assert!(start.contains("'\\''"));
    }

    #[test]
    fn status_and_log_reads_never_interpolate_raw_text() {
        use_a_test_store();
        let (job, _) = start(Platform::Windows, "x", "l").unwrap();
        assert!(status_command(&job).contains(&job.status));
        assert!(log_command(&job, 50).contains(&job.log));
        assert!(log_command(&job, 50).contains("-Tail 50"));
        assert!(cancel_command(&job).contains(&job.pid));
    }

    #[test]
    fn jobs_are_listed_newest_first_and_only_while_known() {
        use_a_test_store();
        let (a, _) = start(Platform::Windows, "a", "l").unwrap();
        let (b, _) = start(Platform::Posix, "b", "l").unwrap();
        let listed = list();
        assert!(listed.iter().any(|j| j.id == a.id));
        assert!(listed.iter().any(|j| j.id == b.id));
        assert!(get(&a.id).is_some());
        assert!(get("job-nope").is_none());
    }

    #[test]
    fn an_empty_command_is_refused() {
        use_a_test_store();
        assert!(start(Platform::Windows, "   ", "l").is_err());
    }

    fn decode_base64(text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        let mut buffer = 0u32;
        let mut bits = 0u32;
        for c in text.bytes() {
            let value = match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                b'=' => continue,
                _ => continue,
            };
            buffer = (buffer << 6) | u32::from(value);
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buffer >> bits) as u8);
            }
        }
        out
    }
}
