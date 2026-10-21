//! The channel the connection sequence asks a question down, shared by the
//! two gates that have one (PRDRDP/00 R13, PRD/10 §3.4).
//!
//! # Why it is not called `TrustPrompt` any more
//!
//! It was, and it was the certificate gate's own type
//! ([`super::trust`]). The credential gate needs exactly the same three
//! things, and the sequence has only one command receiver to lend, so a
//! second type would have meant a second borrow of the same channel. The name
//! moved with the meaning: this is "somebody is there to answer", not
//! "somebody is there to answer about a certificate".
//!
//! # Why it is reborrowed rather than cloned or copied
//!
//! [`Prompt::reborrow`] exists because the two gates run one after the other
//! inside the same [`super::connect`] call and both need `&mut` to the same
//! receiver. `super::trust::approve` takes the prompt by value and consumes
//! it, so without a reborrow the certificate gate would swallow the only
//! handle and the credential gate that runs after it would have nobody to
//! ask, which is the bug this module was written to fix
//! (`crates/rdp-core/src/connection/mod.rs:262`).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use remote_core::ClientCommand;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::credentials::Ask;

/// How long the connection has been waiting on a person, and for how long.
///
/// The connect budget is not a countdown of wall-clock time: the time a
/// person spends typing a password is not the connect stalling, and a
/// connect that gave up on a slow typist would be the worst possible
/// answer to a prompt that asked for one.
///
/// So the budget counts the time the connect was WORKING, and the time the
/// person was answering is added back to it. Two things are needed for that
/// and a boolean is not one of them:
///
///   * whether a prompt is on screen right now, so the timer knows to
///     re-arm instead of failing, and
///   * how long the person has been answering in total, so the budget can
///     be recomputed from one start instant.
///
/// A flag alone gives the first and not the second, and a flag that is
/// cleared on some paths and not others leaves the budget paused forever.
/// So the pause is a value with a guard, and the guard is what makes it
/// honest: it ends the pause when it is dropped, on every path, including
/// an error and a cancellation.
#[derive(Clone, Default)]
pub struct WaitState(Arc<WaitInner>);

#[derive(Default)]
struct WaitInner {
    /// True while a prompt is on screen and unanswered.
    waiting: AtomicBool,
    /// Nanoseconds of the pauses that have ended.
    ended_nanos: AtomicU64,
    /// When the pause that is running now started, if one is.
    running_since: Mutex<Option<Instant>>,
}

impl WaitState {
    /// Is a prompt on screen right now?
    pub fn is_waiting(&self) -> bool {
        self.0.waiting.load(Ordering::Relaxed)
    }

    /// How long the person has been answering, in total.
    ///
    /// A pause that is running counts up to now, so the budget can be
    /// recomputed at the instant the timer fires rather than at the instant
    /// the person finally answers.
    pub fn paused(&self) -> Duration {
        let ended = Duration::from_nanos(self.0.ended_nanos.load(Ordering::Relaxed));
        let running = match *self
            .0
            .running_since
            .lock()
            .unwrap_or_else(|e| e.into_inner())
        {
            Some(since) => since.elapsed(),
            None => Duration::ZERO,
        };
        ended + running
    }

    /// The connect budget, recomputed from one start instant.
    ///
    /// The deadline is `start + budget + everything the person spent`. The
    /// same start for every attempt, so a second attempt after a refused
    /// password does not buy a second budget.
    pub fn deadline(&self, start: Instant, budget: Duration) -> Instant {
        start + budget + self.paused()
    }

    /// Begin a pause. The pause ends when the returned guard is dropped.
    pub fn begin(&self) -> Waiting {
        let mut running = self
            .0
            .running_since
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if running.is_none() {
            *running = Some(Instant::now());
        }
        self.0.waiting.store(true, Ordering::Relaxed);
        Waiting {
            state: self.clone(),
        }
    }

    /// End a pause and add it to the total.
    fn end(&self) {
        let mut running = self
            .0
            .running_since
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(since) = running.take() {
            let nanos = since.elapsed().as_nanos().min(u64::MAX as u128) as u64;
            self.0.ended_nanos.fetch_add(nanos, Ordering::Relaxed);
        }
        self.0.waiting.store(false, Ordering::Relaxed);
    }
}

/// A pause that ends when it is dropped.
///
/// Dropping it is the only way the pause ends, and a guard is dropped on
/// every path out of a function: a returned error, a cancellation, a
/// dismissed dialog. That is what stops the budget being left paused
/// forever, which a bare flag and a hand-written `store(false, …)` on the
/// happy path cannot promise.
pub struct Waiting {
    state: WaitState,
}

impl Drop for Waiting {
    fn drop(&mut self) {
        self.state.end();
    }
}

/// What the sequence needs to raise a prompt and wait for its answer.
///
/// Borrowed rather than owned because the receiver belongs to the session
/// task's supervisor for the whole session and is only lent to the connection
/// sequence: nothing else reads it while the sequence runs, which is the same
/// arrangement `vnc-core` makes for its credential prompt
/// (`crates/vnc-core/src/session/connection.rs:315`, `serve_credential_ask`).
pub struct Prompt<'a> {
    /// The command channel the shell answers on.
    pub commands: &'a mut mpsc::Receiver<ClientCommand>,
    /// Cancelled when the window is gone, so a dialog nobody will ever
    /// answer does not hold the attempt open.
    pub cancel: &'a CancellationToken,
    /// How many credential prompts this chain of attempts has raised and why
    /// the last answer was refused.
    ///
    /// It lives outside the connection sequence because a password the user
    /// types can outlive the connection it was typed on: MS-CSSP 3.1.5 has
    /// the client fail immediately on the server's error code, and the server
    /// has ended the CredSSP exchange by then, so a second try is a second
    /// TCP connection. `crate::session::connect::establish` owns it and reads
    /// it after an attempt fails.
    pub ask: &'a mut Ask,
    /// The connect budget's view of the person.
    ///
    /// Shared rather than kept in [`Ask`], because the attempt holds `ask`
    /// mutably for as long as it runs and the budget is read from outside it.
    pub wait: WaitState,
}

impl<'a> Prompt<'a> {
    /// A prompt with a fresh budget state.
    ///
    /// The constructor exists so that the state is never left out: a field
    /// that every construction site has to remember is a field that some
    /// construction site will forget, and a forgotten one does not compile
    /// but a wrong one does.
    pub fn new(
        commands: &'a mut mpsc::Receiver<ClientCommand>,
        cancel: &'a CancellationToken,
        ask: &'a mut Ask,
        wait: WaitState,
    ) -> Self {
        Self {
            commands,
            cancel,
            ask,
            wait,
        }
    }

    /// Lend the prompt on to a gate that takes it by value.
    ///
    /// The lifetime is the borrow's rather than `'a`, which is what makes a
    /// second gate able to take it afterwards.
    pub fn reborrow(&mut self) -> Prompt<'_> {
        Prompt {
            commands: self.commands,
            cancel: self.cancel,
            ask: self.ask,
            wait: self.wait.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The property the whole module exists for: a gate that consumes the
    /// prompt does not consume the caller's, so the gate after it can still
    /// ask. Written as two consuming calls because that is exactly the shape
    /// `connect` has.
    #[tokio::test]
    async fn a_reborrowed_prompt_leaves_the_original_usable() {
        fn consume(p: Prompt<'_>) -> usize {
            p.commands.capacity()
        }

        let (tx, mut commands) = mpsc::channel(4);
        let cancel = CancellationToken::new();
        let mut ask = Ask::new();
        let mut prompt = Prompt::new(&mut commands, &cancel, &mut ask, WaitState::default());

        assert_eq!(consume(prompt.reborrow()), 4);
        assert_eq!(consume(prompt.reborrow()), 4);
        assert_eq!(consume(prompt), 4);
        drop(tx);
    }

    #[test]
    fn a_pause_is_measured_and_ends_when_its_guard_is_dropped() {
        let state = WaitState::default();
        assert!(!state.is_waiting());
        assert_eq!(state.paused(), Duration::ZERO);

        let guard = state.begin();
        assert!(state.is_waiting());
        // The pause is running, so it counts up to now. The clock is asked
        // after a moment, because a pause that started on this instant can
        // measure zero, and "zero" would not say the pause is counted.
        std::thread::sleep(Duration::from_millis(2));
        assert!(state.paused() > Duration::ZERO);

        drop(guard);
        assert!(!state.is_waiting());
        // And it is still counted: the person spent that time.
        let spent = state.paused();
        assert!(spent > Duration::ZERO);
        std::thread::sleep(Duration::from_millis(5));
        assert_eq!(
            state.paused(),
            spent,
            "a pause that has ended must not keep counting"
        );
    }

    #[test]
    fn a_pause_that_is_forgotten_ends_when_its_scope_ends() {
        // The guard is what makes the promise: a function that returns an
        // error drops it, and the budget is not left paused.
        let state = WaitState::default();
        {
            let _guard = state.begin();
            assert!(state.is_waiting());
        }
        assert!(!state.is_waiting());
    }
}
