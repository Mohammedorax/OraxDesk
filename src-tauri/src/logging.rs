//! The file sink beside the console one.
//!
//! A packaged Windows build has no console, so when the app fails on a
//! customer's machine there is nothing to send. This writes the same events,
//! under the same `RUST_LOG` filter, to `<app data>/logs/oraxdesk.log`, and
//! keeps that file bounded by rolling it over to `oraxdesk.log.1`.
//!
//! Logging is never the reason the app does not start: a sink that cannot be
//! opened simply does not exist, and the console keeps working as before.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter, Layer};

/// How large the live file may get before it becomes `.1`, so a machine left
/// running for weeks holds at most about twice this.
const MAX_BYTES: u64 = 5 * 1024 * 1024;
const FILE: &str = "oraxdesk.log";
const PREVIOUS: &str = "oraxdesk.log.1";

/// Installs the console sink, plus the file sink when one can be opened.
///
/// `data_dir` is the per-user app data directory the store lives in; `None`
/// means the platform would not name one, which costs only the file sink.
pub fn init(data_dir: Option<&Path>) {
    // The same filter the console has always used, so `RUST_LOG` behaviour is
    // unchanged: one variable, both sinks.
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,deskvncviewer_lib=debug"));

    let sink = match data_dir {
        Some(dir) => Logs::open(&dir.join("logs"), MAX_BYTES),
        None => Err(io::Error::new(
            io::ErrorKind::NotFound,
            "the platform did not name an app data directory",
        )),
    };

    let console = fmt::layer().with_filter(filter.clone());
    match &sink {
        Ok(logs) => tracing_subscriber::registry()
            .with(console)
            // No colour codes in a file: whoever reads this opens it in an
            // editor, not a terminal.
            .with(
                fmt::layer()
                    .with_ansi(false)
                    .with_writer(Sink(logs.clone()))
                    .with_filter(filter),
            )
            .init(),
        Err(_) => tracing_subscriber::registry().with(console).init(),
    }

    // After `init`, so the notice itself goes to stdout like everything else.
    if let Err(error) = sink {
        tracing::warn!(%error, "the log file could not be opened; logging to stdout only");
    }
}

/// One file for the whole process, and the size that decides a rollover.
struct Logs {
    state: Mutex<LogFile>,
    limit: u64,
}

struct LogFile {
    path: PathBuf,
    /// `None` after a rollover that could not put a file back; writing then
    /// stops rather than panicking, and the next rollover point tries again.
    file: Option<File>,
    written: u64,
    /// No rollover is attempted before this size: one failed rename should not
    /// become a syscall on every single event.
    retry_at: u64,
}

impl Logs {
    fn open(dir: &Path, limit: u64) -> io::Result<Arc<Self>> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(FILE);
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let written = file.metadata().map(|meta| meta.len()).unwrap_or(0);
        Ok(Arc::new(Self {
            limit,
            state: Mutex::new(LogFile {
                path,
                file: Some(file),
                written,
                retry_at: 0,
            }),
        }))
    }

    /// Best effort by design: whatever happens to the file, the event has
    /// already gone to stdout and the caller gets `Ok`.
    fn append(&self, buf: &[u8]) {
        let mut state = self.state.lock();
        if state.written + buf.len() as u64 > self.limit {
            state.roll_over(self.limit);
        }
        let LogFile { file, written, .. } = &mut *state;
        if let Some(file) = file.as_mut() {
            if file.write_all(buf).is_ok() {
                *written += buf.len() as u64;
            }
        }
    }
}

impl LogFile {
    fn roll_over(&mut self, limit: u64) {
        if self.written < self.retry_at {
            return;
        }
        // Windows refuses to rename a file that is still open, so close this
        // one first and let the reopen below decide whether the sink survives.
        self.file = None;
        let previous = self.path.with_file_name(PREVIOUS);
        let rolled = match std::fs::remove_file(&previous) {
            Ok(()) => std::fs::rename(&self.path, &previous),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                std::fs::rename(&self.path, &previous)
            }
            Err(error) => Err(error),
        };
        let reopened = rolled
            .and_then(|()| OpenOptions::new().create(true).append(true).open(&self.path));
        match reopened {
            Ok(file) => {
                self.file = Some(file);
                self.written = 0;
                self.retry_at = 0;
            }
            Err(_) => {
                // Someone else holds the file, or the folder is read-only.
                // Keep appending if that still works, and try the rename again
                // once another cap has gone by, so the file stays bounded by
                // roughly `limit` rather than growing forever.
                self.file = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&self.path)
                    .ok();
                self.retry_at = self.written.saturating_add(limit);
            }
        }
    }
}

/// `fmt` asks for a writer per event; handing it a handle into the shared file
/// keeps one open file and one rollover check for the process.
#[derive(Clone)]
struct Sink(Arc<Logs>);

impl Write for Sink {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.append(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> fmt::MakeWriter<'a> for Sink {
    type Writer = Sink;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rolls_over_keeping_one_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let logs = Logs::open(&dir.path().join("logs"), 64).unwrap();
        for _ in 0..20 {
            logs.append(b"a line of the log that is long enough to matter\n");
        }
        let live = std::fs::read(dir.path().join("logs").join(FILE)).unwrap();
        let previous = std::fs::read(dir.path().join("logs").join(PREVIOUS)).unwrap();
        assert!(live.len() as u64 <= 64 + 64, "the live file stayed near the cap");
        assert!(
            previous.len() as u64 <= 64 + 64,
            "the previous file stayed near the cap"
        );
    }

    #[test]
    fn an_event_reaches_the_file_with_the_console_fields() {
        let dir = tempfile::tempdir().unwrap();
        let logs = Logs::open(&dir.path().join("logs"), MAX_BYTES).unwrap();
        let subscriber = tracing_subscriber::registry()
            .with(fmt::layer().with_ansi(false).with_writer(Sink(logs.clone())));
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(answer = 42, "hello from the file sink");
        });
        let text = std::fs::read_to_string(dir.path().join("logs").join(FILE)).unwrap();
        assert!(text.starts_with(|c: char| c.is_ascii_digit()), "{text}");
        assert!(text.contains("INFO"), "{text}");
        assert!(text.contains("logging::tests"), "{text}");
        assert!(text.contains("hello from the file sink"), "{text}");
        assert!(text.contains("answer=42"), "{text}");
    }
}
