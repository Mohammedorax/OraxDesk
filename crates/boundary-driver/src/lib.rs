#![forbid(unsafe_code)]

use anyhow::{anyhow, bail, ensure, Result};
use boundary_session::{
    tools::{Client, Reply, Request},
    unattended::{self, SecretKey},
    Button, Event, HostOptions, Input, Invitation, Key, Session,
};
use parking_lot::Mutex;
use remote_core::reconnect::{classify, Decision, RetryClassify, STABLE_UPTIME};
use remote_core::{
    ClientCommand, ConnectOptions, DecodedRect, OptionsMismatch, ProtocolDriver, ProtocolKind,
    ReconnectPolicy, Rect, RectPayload, SessionEvent, SessionHandle, SessionState,
};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

struct Pending {
    ticket: String,
    helper: String,
    created: Instant,
}
/// Told when a person being helped lets this helper come back any time:
/// the machine's ID and its name, to save in the Library.
pub type OnPaired = std::sync::Arc<dyn Fn(String, String) + Send + Sync>;
/// The tools client of every live session whose host serves them, by
/// session ID.
type Registry = std::sync::Arc<Mutex<HashMap<String, Client>>>;
#[derive(Default)]
pub struct BoundaryDriver {
    pending: std::sync::Arc<Mutex<HashMap<String, Pending>>>,
    identity: std::sync::Arc<Mutex<Option<SecretKey>>>,
    paired: std::sync::Arc<Mutex<Option<OnPaired>>>,
    tools: Registry,
    /// The address directory a saved machine is looked up in, when the app has
    /// a registry configured.
    ///
    /// A by-number connection resolves the NUMBER in the app's registry, so
    /// the ADDRESS must come from the same directory: looking one up in
    /// Cloudflare and the other up in n0 means a machine that published to
    /// only one of them is registered and unreachable at the same time. `None`
    /// keeps the public n0 directory, which is what every build without a
    /// registry has always used.
    directory: std::sync::Arc<Mutex<Option<String>>>,
}
impl BoundaryDriver {
    /// How to send commands and file requests to the computer behind
    /// `session_id`, while that session lasts. `None` when there is no such
    /// session, it has not connected yet, or the computer's OraxDesk Support
    /// is too old to serve them. Whether the person there allows them is
    /// [`Client::allowed`], and the computer checks again on every request.
    pub fn tools(&self, session_id: &str) -> Option<Client> {
        self.tools.lock().get(session_id).cloned()
    }
    /// This helper's lasting identity. Without it every session uses a fresh
    /// one, so a pairing could never be recognised later.
    pub fn set_identity(&self, key: SecretKey) {
        *self.identity.lock() = Some(key);
    }
    /// What to do when a session tells this helper it was paired.
    pub fn on_paired(&self, paired: OnPaired) {
        *self.paired.lock() = Some(paired);
    }
    /// Point a saved-machine connection at the same address directory the app
    /// registers devices in. `None` restores the public n0 directory.
    ///
    /// Only reads happen with this: a helper publishes nothing about itself.
    pub fn set_directory(&self, url: Option<String>) {
        *self.directory.lock() = url
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
    }
    /// Register a short lived, single use invitation without putting its secret in window URLs.
    pub fn prepare(&self, ticket: String, helper: String) -> Result<String> {
        Invitation::decode(&ticket)?;
        ensure!(
            !helper.trim().is_empty()
                && helper.len() <= 80
                && !helper.chars().any(char::is_control),
            "Enter a helper name of at most 80 bytes"
        );
        let mut pending = self.pending.lock();
        pending.retain(|_, value| value.created.elapsed() < Duration::from_secs(60));
        ensure!(pending.len() < 32, "Too many pending support connections");
        let id = format!("boundary-{}", uuid::Uuid::new_v4());
        pending.insert(
            id.clone(),
            Pending {
                ticket,
                helper,
                created: Instant::now(),
            },
        );
        drop(pending);
        let expiry_map = self.pending.clone();
        let expiry_id = id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;
            expiry_map.lock().remove(&expiry_id);
        });
        Ok(id)
    }
    pub fn forget(&self, id: &str) {
        self.pending.lock().remove(id);
    }
}
impl ProtocolDriver for BoundaryDriver {
    fn kind(&self) -> ProtocolKind {
        ProtocolKind::Boundary
    }
    fn spawn(
        &self,
        id: String,
        options: ConnectOptions,
        events: mpsc::Sender<SessionEvent>,
    ) -> std::result::Result<SessionHandle, OptionsMismatch> {
        if options.kind() != self.kind() {
            return Err(OptionsMismatch {
                expected: self.kind(),
                actual: options.kind(),
            });
        }
        let pending = self.pending.lock().remove(&options.host);
        // A saved machine is opened by its ID; an invitation by the one use
        // token `prepare` handed out. Only a saved machine can be retried.
        let unattended =
            pending.is_none() && unattended::validate_machine_id(&options.host).is_ok();
        let identity = self.identity.lock().clone();
        let paired = self.paired.lock().clone();
        let registry = self.tools.clone();
        // Read once, at spawn: the directory a saved machine is looked up in.
        let directory_url = self.directory.lock().clone();
        let session_id = id.clone();
        let (commands, mut receiver) = mpsc::channel(128);
        let cancel = CancellationToken::new();
        let token = cancel.clone();
        tokio::spawn(async move {
            // `Some(pending)` spends the one use token `prepare` handed out,
            // so the invitation arm opens exactly once and leaves on its
            // first outcome, as it always has. Only the saved-machine arm
            // goes round the loop below.
            let mut invitation = pending;
            let policy = options.reconnect;
            let mut attempts_made: u32 = 0;
            let result: Result<()> = loop {
                // When this attempt first reached `Connected`, which is both
                // what the ladder's stability reset measures from and the
                // fact its transient classification turns on (see
                // [`Failure`]).
                let mut connected_at: Option<Instant> = None;
                let attempt = async {
                    let mut session = match invitation.take() {
                        Some(pending) => {
                            ensure!(
                                pending.created.elapsed() < Duration::from_secs(60),
                                "Support connection expired before the window opened"
                            );
                            // With tools declared, so the person is asked about
                            // commands and files and an agent can use them once
                            // they say yes.
                            boundary_session::viewer_with_tools(
                                pending.ticket,
                                pending.helper,
                                HostOptions::default(),
                                identity.clone(),
                            )
                        }
                        None if unattended => {
                            let key = identity.clone().ok_or_else(|| anyhow!("This copy of OraxDesk has no helper identity, so it cannot be recognised by a computer it was paired with"))?;
                            let name = options
                                .credentials
                                .username
                                .clone()
                                .filter(|n| !n.trim().is_empty())
                                .unwrap_or_else(helper_name);
                            // The registry the number was resolved in is the first
                            // place the address is looked for. n0 stays in place as
                            // a second source, so a registry that is down — or a
                            // machine that has not published there yet — does not
                            // hide a machine that n0 can find.
                            let host_options = match directory_url.clone() {
                                Some(url) => boundary_session::HostOptions {
                                    directory: Some(boundary_session::DirectoryOptions {
                                        url,
                                        signing_key: None,
                                    }),
                                    ..boundary_session::HostOptions::default()
                                },
                                None => boundary_session::HostOptions::default()
                                    .with_directory_from_env(None),
                            };
                            unattended::connect_with_tools(
                                options.host.clone(),
                                name,
                                options.credentials.password.clone().filter(|p| !p.is_empty()),
                                key,
                                host_options,
                            )
                        }
                        None => bail!("This support invitation is no longer available. Paste a new invitation in the Library"),
                    };
                    drive(
                        &mut session,
                        &mut receiver,
                        &events,
                        options.view_only,
                        paired.clone(),
                        Tools {
                            registry: registry.clone(),
                            session_id: session_id.clone(),
                        },
                        &mut connected_at,
                    )
                    .await
                };
                let outcome = tokio::select! {
                    biased;
                    _ = token.cancelled() => Ok(()),
                    result = attempt => result,
                };
                let error = match outcome {
                    Ok(()) => break Ok(()),
                    Err(error) => error,
                };
                // An attempt that stayed up long enough proves the machine is
                // reachable again, so the ladder restarts from its first step
                // (the rule the shared supervisor applies at the same point,
                // `remote_core::reconnect::STABLE_UPTIME`).
                if connected_at.is_some_and(|at| at.elapsed() >= STABLE_UPTIME) {
                    attempts_made = 0;
                }
                let failure = Failure {
                    error,
                    reached_connected: connected_at.is_some(),
                };
                match attempt_decision(unattended, &failure, &policy, attempts_made) {
                    // `can_retry` is the tail's to state, exactly as before:
                    // a saved machine may always be dialled again by hand and
                    // an invitation never may (`can_retry: unattended`).
                    Decision::Stop { .. } => break Err(failure.error),
                    Decision::Retry => {
                        attempts_made += 1;
                        let delay = policy.delay_for(attempts_made, jitter_unit());
                        // The same state the shared ladder emits on its way
                        // up (`remote_core::reconnect::supervise`), carrying
                        // the failure's own words rather than a new sentence.
                        if emit(
                            &events,
                            SessionEvent::StateChanged(SessionState::Reconnecting {
                                attempt: attempts_made,
                                next_retry_ms: delay.as_millis() as u64,
                                reason: failure.error.to_string(),
                            }),
                        )
                        .await
                        .is_err()
                        {
                            break Ok(()); // shell is gone
                        }
                        let sleep = tokio::time::sleep(delay);
                        tokio::pin!(sleep);
                        let stop = tokio::select! {
                            biased;
                            _ = token.cancelled() => true,
                            _ = &mut sleep => false,
                            command = receiver.recv() => match command {
                                // The three the shared supervisor takes here
                                // (`remote_core::reconnect::wait_backoff`):
                                // the handle is gone, or the user hung up, or
                                // "retry now" skips the remaining backoff.
                                None | Some(ClientCommand::Disconnect) => true,
                                Some(ClientCommand::ReconnectNow) => { attempts_made = 0; false }
                                // Input and agent intents addressed to a
                                // session that no longer exists are dropped;
                                // the session they were for is over.
                                Some(_) => false,
                            },
                        };
                        if stop {
                            break Ok(());
                        }
                    }
                }
            };
            let failed = result.is_err();
            let reason = match result {
                Ok(()) => "Support session ended".into(),
                Err(error) => error.to_string(),
            };
            let _ = events
                .send(SessionEvent::StateChanged(SessionState::Disconnected {
                    reason,
                    can_retry: unattended,
                    symbol: terminal_symbol(unattended, failed),
                }))
                .await;
        });
        Ok(SessionHandle {
            id,
            kind: ProtocolKind::Boundary,
            commands,
            cancel,
        })
    }
}
async fn emit(events: &mpsc::Sender<SessionEvent>, event: SessionEvent) -> Result<()> {
    events
        .send(event)
        .await
        // [`ShellGone`] rather than a bare `anyhow!`: the reconnect loop
        // downcasts it to tell "the session failed" from "the shell that was
        // listening to it is gone", and only the first of those may be
        // redialled.
        .map_err(|_| anyhow::Error::new(ShellGone))
}

/// Our own failure, not the session's: the shell's event channel is closed,
/// so nothing is listening any more.
///
/// Carries the same sentence [`emit`] always produced for it, because a
/// closed shell says the same thing however the loop below is classified.
#[derive(Debug)]
struct ShellGone;
impl std::fmt::Display for ShellGone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Session window closed")
    }
}
impl std::error::Error for ShellGone {}

/// One failed attempt of a support session, reduced to what the reconnect
/// ladder can ask of it.
///
/// `boundary-session`'s failures are `anyhow::Error` with no taxonomy
/// (`crates/boundary-session/src/session.rs:51`) and that crate is not this
/// change's to edit, so the ladder is fed the two facts this side can know
/// on its own rather than a guess read out of a message.
struct Failure {
    error: anyhow::Error,
    /// The attempt reached `Connected` before failing, so what ended it ended
    /// a LIVE link: a relay dropping, a machine sleeping, the network moving
    /// under it. That is the transient failure the documented policy
    /// (`crates/remote-core/src/options.rs:570`) says the ladder redials.
    ///
    /// Before `Connected` the same `anyhow::Error` also carries the outcomes
    /// a retry must never guess through — the person declining, a wrong
    /// password (whose retries are what pauses password access for fifteen
    /// minutes, `crates/boundary-session/src/unattended.rs:592`), unattended
    /// access switched off — beside the unreachable machine, and nothing in
    /// this crate can tell those apart honestly. So a failure that never
    /// connected is stopped, with the manual retry button it has always had.
    reached_connected: bool,
}

impl RetryClassify for Failure {
    /// Cancellation is not an error here: it leaves through the token and
    /// breaks the loop as a clean end.
    fn is_cancelled(&self) -> bool {
        false
    }
    /// Only a dropped LIVE link. A closed event channel is the shell being
    /// gone (`ShellGone`), and redialling into a shell that is not listening
    /// would loop on the same closed channel forever.
    fn is_transient(&self) -> bool {
        self.reached_connected && self.error.downcast_ref::<ShellGone>().is_none()
    }
    /// Nothing here is a "fix me" failure: the outcomes a human must act on
    /// arrive before `Connected` and are already stopped by
    /// [`Self::is_transient`] returning false.
    fn needs_user_action(&self) -> bool {
        false
    }
    fn user_message(&self) -> String {
        self.error.to_string()
    }
}

/// What one failed attempt deserves: the ladder's own verdict for a saved
/// machine, or the stop an invitation has always taken.
///
/// The one rule the shared ladder has no word for is the invitation's single
/// use: `prepare`'s token was spent at spawn, so no verdict but a stop can be
/// right for it, and the ladder's `Stop` for a non-transient failure offers
/// a manual retry that would only fail again on a spent token.
fn attempt_decision(
    unattended: bool,
    failure: &Failure,
    policy: &ReconnectPolicy,
    attempts_made: u32,
) -> Decision {
    if !unattended {
        return Decision::Stop { can_retry: false };
    }
    classify(failure, policy, attempts_made)
}

/// The stable identifier the UI matches when an INVITATION session ended in
/// a failure (`SessionState::Disconnected::symbol`, the same channel RDP and
/// SSH use — `remote_core::reconnect::RetryClassify::symbol`).
///
/// An invitation is single use: `prepare`'s token was spent when this session
/// opened it, so no reconnect can ever succeed — only a NEW code from the
/// person being helped can open another session. The symbol carries that
/// across IPC so the disconnect panel offers the re-invite entry instead of
/// a reconnect that would only fail again on the spent token. The invitation
/// is never redialled here either (`attempt_decision` above stops it), so
/// single use stays intact on both sides of the wire.
///
/// `None` for a saved machine, whose failures keep the manual retry it has
/// always had, and for the user's own disconnect, which is a clean end
/// rather than a failure.
fn terminal_symbol(unattended: bool, failed: bool) -> Option<String> {
    const INVITATION_SPENT: &str = "invitation-spent";
    (!unattended && failed).then(|| INVITATION_SPENT.to_string())
}

/// The `rand_unit` [`ReconnectPolicy::delay_for`] asks for.
///
/// The clock's sub-second digits rather than a dependency: this crate has no
/// `rand`, and jitter only needs the ladder's delays to stop lining up, not
/// values nobody could predict.
fn jitter_unit() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.subsec_nanos())
        .unwrap_or(0);
    f64::from(nanos) / 1_000_000_000.0
}
async fn permission(events: &mpsc::Sender<SessionEvent>, allowed: bool, tools: bool) -> Result<()> {
    emit(
        events,
        SessionEvent::Protocol(remote_core::ProtocolEvent::Boundary {
            control: allowed,
            tools,
        }),
    )
    .await
}
/// Said when the person at the computer has not allowed commands and files.
pub const NOT_ALLOWED: &str = "the person at that computer has not allowed commands and files for this session. Ask them to tick Allow the helper's tools to run commands and copy files in OraxDesk Support, or, for an unattended computer, to allow it for this helper under Settings, Unattended access. Nothing ran";
/// Said when the computer's support app predates commands and files.
pub const TOO_OLD: &str = "that computer's OraxDesk Support is older than commands and files over Boundary, so it cannot run a command. Ask them to update it from the latest release. Nothing ran";
/// Where this session's tools client is published, and taken back from.
struct Tools {
    registry: Registry,
    session_id: String,
}
impl Drop for Tools {
    fn drop(&mut self) {
        self.registry.lock().remove(&self.session_id);
    }
}

/// Run one command on the computer, and answer the intent with what running
/// it produced. Spawned, so a long command never holds up the screen.
///
/// Nothing here invents a status. A command the computer refused or could
/// not start is a refusal, because nothing ran. A link lost after the
/// request went out is a served answer saying so, because the command may
/// well have run.
fn exec(
    client: Client,
    intent: remote_core::intent::AgentIntent,
    events: mpsc::Sender<SessionEvent>,
) {
    use remote_core::intent::{
        CommandExit, CommandRun, Dropped, ExitTier, IntentKind, ServedAnswer, Truncation,
        Unanswered,
    };
    tokio::spawn(async move {
        let IntentKind::Exec { spec } = &intent.kind else {
            return;
        };
        let request = Request::Run {
            command: spec.command.clone(),
            cwd: spec.cwd.clone(),
            env: spec.env.clone(),
            timeout_ms: spec.timeout.as_millis().min(u128::from(u64::MAX)) as u64,
            max_output: spec.max_output_bytes.unwrap_or(0),
        };
        let stdin = spec.stdin.as_deref().unwrap_or_default();
        let started = Instant::now();
        let event = match client
            .call(&request, stdin, spec.timeout + Duration::from_secs(15))
            .await
        {
            Ok((
                Reply::Ran {
                    code,
                    signal,
                    timed_out,
                    stdout,
                    cap,
                    stdout_dropped,
                    stdout_dropped_lines,
                    stderr_dropped,
                    stderr_dropped_lines,
                    duration_ms,
                },
                body,
            )) => {
                let split = (stdout as usize).min(body.len());
                let unanswered = if timed_out {
                    Some(Unanswered::Deadline)
                } else if code.is_none() && signal.is_none() {
                    Some(Unanswered::Tier)
                } else {
                    None
                };
                SessionEvent::AgentServed(intent.serve(ServedAnswer::Ran(CommandRun {
                    status: CommandExit {
                        // The process's own exit status, read by the computer
                        // that ran it, which is what the exec tier means.
                        code: if timed_out { None } else { code },
                        signal: if timed_out { None } else { signal },
                        source: ExitTier::Exec,
                        unanswered,
                    },
                    stdout: body[..split].to_vec().into(),
                    stderr: body[split..].to_vec().into(),
                    dropped: Truncation {
                        cap,
                        stdout: Dropped {
                            bytes: stdout_dropped,
                            lines: stdout_dropped_lines,
                        },
                        stderr: Dropped {
                            bytes: stderr_dropped,
                            lines: stderr_dropped_lines,
                        },
                    },
                    duration: Duration::from_millis(duration_ms),
                })))
            }
            Ok((Reply::Refused(why) | Reply::Failed(why), _)) => {
                SessionEvent::AgentRefused(intent.refuse(why))
            }
            Ok(_) => SessionEvent::AgentRefused(intent.refuse(
                "the computer answered that command with something other than a run, so nothing is reported rather than a guessed status",
            )),
            // The error's own words are not put in stderr: that field is what
            // the far side printed, and these are ours.
            Err(_) => SessionEvent::AgentServed(intent.serve(ServedAnswer::Ran(CommandRun {
                status: CommandExit {
                    code: None,
                    signal: None,
                    source: ExitTier::Exec,
                    unanswered: Some(Unanswered::LinkLost),
                },
                stdout: Vec::new().into(),
                stderr: Vec::new().into(),
                dropped: Truncation {
                    cap: 0,
                    stdout: Dropped::default(),
                    stderr: Dropped::default(),
                },
                duration: started.elapsed(),
            }))),
        };
        let _ = events.send(event).await;
    });
}
/// The name a helper is shown by when none was given: the account name.
fn helper_name() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .ok()
        .filter(|n| !n.trim().is_empty() && n.len() <= 80)
        .unwrap_or_else(|| "OraxDesk helper".into())
}
async fn drive(
    session: &mut Session,
    commands: &mut mpsc::Receiver<ClientCommand>,
    events: &mpsc::Sender<SessionEvent>,
    mut view_only: bool,
    paired: Option<OnPaired>,
    published: Tools,
    connected_at: &mut Option<Instant>,
) -> Result<()> {
    let mut size = (0u16, 0u16);
    let mut input = InputState::default();
    let mut allowed = false;
    let mut tools_allowed = false;
    emit(events, SessionEvent::StateChanged(SessionState::Connecting)).await?;
    loop {
        tokio::select! {
            event = session.events.recv() => match event {
                Some(Event::Status(status)) => emit(events, SessionEvent::StateChanged(SessionState::Authenticating { method: status })).await?,
                Some(Event::Connected { control, .. }) => {
                    // The first `Connected` is when this attempt became a live
                    // link: the ladder measures stability from it and
                    // classifies this attempt's failures by it (see
                    // [`Failure`]).
                    connected_at.get_or_insert_with(Instant::now);
                    allowed = control;
                    if let Some(client) = session.tools() {
                        tools_allowed = client.allowed();
                        published.registry.lock().insert(published.session_id.clone(), client);
                    }
                    emit(events, SessionEvent::DesktopName("Boundary support".into())).await?;
                    permission(events, allowed, tools_allowed).await?;
                    emit(events, SessionEvent::StateChanged(SessionState::Connected)).await?;
                }
                Some(Event::Control(control)) => {
                    allowed = control;
                    input = InputState::default();
                    session.input(Input::Release)?;
                    permission(events, allowed, tools_allowed).await?;
                }
                Some(Event::Tools(value)) => {
                    tools_allowed = value;
                    permission(events, allowed, tools_allowed).await?;
                }
                Some(Event::Paired { machine, name }) => {
                    if let Some(paired) = paired.as_ref() { paired(machine, name); }
                }
                Some(Event::Finished(result)) => return result,
                None => return Ok(()),
                _ => {},
            },
            frame = session.frames.changed() => {
                frame?;
                let frame = session.frames.borrow_and_update().clone();
                if let Some(frame) = frame {
                    let current = (frame.width as u16, frame.height as u16);
                    if size != current {
                        size = current;
                        emit(events, SessionEvent::DesktopResize { width: size.0, height: size.1 }).await?;
                    }
                    let rect = Rect { x: 0, y: 0, width: size.0, height: size.1 };
                    emit(events, SessionEvent::FramebufferUpdate { rects: vec![DecodedRect { rect, payload: RectPayload::Rgba(frame.rgba.clone()) }], damage: rect }).await?;
                }
            },
            command = commands.recv() => match command {
                None | Some(ClientCommand::Disconnect) | Some(ClientCommand::CancelCredentials) => return Ok(()),
                Some(ClientCommand::SetViewOnly(value)) => {
                    view_only = value;
                    input = InputState::default();
                    session.input(Input::Release)?;
                }
                Some(ClientCommand::ReleaseAllKeys) => { input = InputState::default(); session.input(Input::Release)?; }
                Some(command @ (ClientCommand::Pointer { .. } | ClientCommand::Key { .. })) if allowed && !view_only => {
                    for event in input.translate(command, size) { session.input(event)?; }
                }
                Some(ClientCommand::Agent(intent)) => {
                    let is_exec = matches!(intent.kind, remote_core::intent::IntentKind::Exec { .. });
                    match session.tools() {
                        Some(client) if is_exec && client.allowed() => exec(client, intent, events.clone()),
                        client => {
                            let why = match (is_exec, client) {
                                (true, Some(_)) => NOT_ALLOWED,
                                (true, None) => TOO_OLD,
                                _ => "Boundary serves exec natively and nothing else; the other intents are lowered to input by the plane",
                            };
                            emit(events, SessionEvent::AgentRefused(intent.refuse(why))).await?;
                        }
                    }
                }
                _ => {},
            }
        }
    }
}
#[derive(Default)]
struct InputState {
    buttons: u16,
    modifiers: u8,
}
impl InputState {
    fn translate(&mut self, command: ClientCommand, size: (u16, u16)) -> Vec<Input> {
        let mut out = Vec::new();
        match command {
            ClientCommand::Pointer { x, y, button_mask } if size.0 > 0 && size.1 > 0 => {
                out.push(Input::Move {
                    x: x.min(size.0 - 1) as f32 / size.0.saturating_sub(1).max(1) as f32,
                    y: y.min(size.1 - 1) as f32 / size.1.saturating_sub(1).max(1) as f32,
                });
                for (mask, button) in [(1, Button::Left), (2, Button::Middle), (4, Button::Right)] {
                    if (self.buttons ^ button_mask) & mask != 0 {
                        out.push(Input::Button {
                            button,
                            down: button_mask & mask != 0,
                        });
                    }
                }
                if button_mask & 8 != 0 && self.buttons & 8 == 0 {
                    out.push(Input::Scroll { lines: -3 });
                }
                if button_mask & 16 != 0 && self.buttons & 16 == 0 {
                    out.push(Input::Scroll { lines: 3 });
                }
                self.buttons = button_mask;
            }
            ClientCommand::Key { keysym, down, .. } => {
                let special = match keysym {
                    0xff0d => Some(Key::Enter),
                    0xff09 => Some(Key::Tab),
                    0xff1b => Some(Key::Escape),
                    0xff08 => Some(Key::Backspace),
                    0xffff => Some(Key::Delete),
                    0xff51 => Some(Key::Left),
                    0xff53 => Some(Key::Right),
                    0xff52 => Some(Key::Up),
                    0xff54 => Some(Key::Down),
                    0xff50 => Some(Key::Home),
                    0xff57 => Some(Key::End),
                    0xff55 => Some(Key::PageUp),
                    0xff56 => Some(Key::PageDown),
                    0xffe1 | 0xffe2 => Some(Key::Shift),
                    0xffe3 | 0xffe4 => Some(Key::Control),
                    0xffe9 | 0xffea => Some(Key::Alt),
                    0xffeb | 0xffec | 0xffe7 | 0xffe8 => Some(Key::Meta),
                    _ => None,
                };
                if let Some(key) = special {
                    let mask = match key {
                        Key::Control => 1,
                        Key::Alt => 2,
                        Key::Meta => 4,
                        _ => 0,
                    };
                    if down {
                        self.modifiers |= mask;
                    } else {
                        self.modifiers &= !mask;
                    }
                    out.push(Input::Key { key, down });
                } else {
                    let code = if keysym & 0xff000000 == 0x01000000 {
                        keysym & 0x00ffffff
                    } else {
                        keysym
                    };
                    if let Some(c) = char::from_u32(code).filter(|c| !c.is_control()) {
                        if c.is_ascii_alphanumeric() && (self.modifiers != 0 || !down) {
                            out.push(Input::Key {
                                key: Key::Letter(c.to_ascii_lowercase()),
                                down,
                            });
                        } else if down {
                            out.push(Input::Text(c.to_string()));
                        }
                    }
                }
            }
            _ => {}
        }
        out
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn coordinates_buttons_and_unicode_are_translated() {
        let mut state = InputState::default();
        let events = state.translate(
            ClientCommand::Pointer {
                x: 639,
                y: 359,
                button_mask: 1,
            },
            (640, 360),
        );
        assert!(matches!(events[0], Input::Move { x: 1.0, y: 1.0 }));
        assert!(matches!(
            events[1],
            Input::Button {
                button: Button::Left,
                down: true
            }
        ));
        let events = state.translate(
            ClientCommand::Key {
                keysym: 0x010003bb,
                keycode: None,
                down: true,
            },
            (640, 360),
        );
        assert!(matches!(&events[0], Input::Text(s) if s == "λ"));
    }
    #[test]
    fn bad_invitation_is_never_registered() {
        let driver = BoundaryDriver::default();
        assert!(driver.prepare("bad".into(), "Helper".into()).is_err());
        assert!(driver.pending.lock().is_empty());
    }

    fn failure(reached_connected: bool) -> Failure {
        Failure {
            error: anyhow!("the link went away"),
            reached_connected,
        }
    }

    /// An invitation is spent the moment it is opened, so no verdict but a
    /// stop can be right for it — not even one the ladder would call
    /// transient for a saved machine.
    #[test]
    fn an_invitation_is_never_redialled() {
        let policy = ReconnectPolicy::default();
        assert_eq!(
            attempt_decision(false, &failure(false), &policy, 0),
            Decision::Stop { can_retry: false }
        );
        assert_eq!(
            attempt_decision(false, &failure(true), &policy, 0),
            Decision::Stop { can_retry: false }
        );
    }

    /// The one thing the terminal state says that a reconnect button could
    /// not: for an invitation that FAILED the code is spent, so the UI's way
    /// back in is a new one. The user's own disconnect is a clean end, and a
    /// saved machine keeps its manual retry, so neither carries a symbol.
    #[test]
    fn an_invitation_that_failed_says_the_code_is_spent() {
        assert_eq!(
            terminal_symbol(false, true).as_deref(),
            Some("invitation-spent")
        );
        assert_eq!(terminal_symbol(false, false), None);
        assert_eq!(terminal_symbol(true, true), None);
    }

    /// The documented policy (`crates/remote-core/src/options.rs:570`) as the
    /// ladder applies it to a saved, paired machine: a link that dropped
    /// AFTER it was up is a transient relay failure and is redialled, where
    /// before this it was terminal.
    #[test]
    fn a_saved_machine_whose_link_dropped_after_connecting_is_redialled() {
        assert_eq!(
            attempt_decision(true, &failure(true), &ReconnectPolicy::default(), 0),
            Decision::Retry
        );
    }

    /// Before `Connected` the same `anyhow::Error` also carries the refusals
    /// a retry must not guess through (a declined pairing, a wrong password),
    /// so the attempt stops — with the manual retry a saved machine has
    /// always been offered.
    #[test]
    fn a_failure_before_connect_is_stopped_with_the_manual_retry() {
        assert_eq!(
            attempt_decision(true, &failure(false), &ReconnectPolicy::default(), 0),
            Decision::Stop { can_retry: true }
        );
    }

    /// A closed event channel is the shell being gone; redialling into a
    /// shell that is not listening would loop on the same closed channel.
    #[test]
    fn a_closed_shell_is_never_redialled() {
        let failure = Failure {
            error: anyhow::Error::new(ShellGone),
            reached_connected: true,
        };
        assert_eq!(
            attempt_decision(true, &failure, &ReconnectPolicy::default(), 0),
            Decision::Stop { can_retry: true }
        );
    }

    /// The shared ladder's own policy knobs keep meaning what they mean for
    /// every other protocol.
    #[test]
    fn the_ladder_honours_max_attempts_and_the_enabled_switch() {
        let capped = ReconnectPolicy {
            max_attempts: Some(2),
            ..ReconnectPolicy::default()
        };
        assert_eq!(
            attempt_decision(true, &failure(true), &capped, 1),
            Decision::Retry
        );
        assert_eq!(
            attempt_decision(true, &failure(true), &capped, 2),
            Decision::Stop { can_retry: true }
        );
        let off = ReconnectPolicy {
            enabled: false,
            ..ReconnectPolicy::default()
        };
        assert_eq!(
            attempt_decision(true, &failure(true), &off, 0),
            Decision::Stop { can_retry: true }
        );
    }

    /// Jitter only needs the ladder's delays to stop lining up; whatever the
    /// clock hands over must still be a unit for `delay_for`.
    #[test]
    fn the_jitter_source_is_a_unit_interval() {
        for _ in 0..64 {
            let unit = jitter_unit();
            assert!((0.0..1.0).contains(&unit), "{unit}");
        }
    }
}
