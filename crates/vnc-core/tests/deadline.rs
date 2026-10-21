//! The connect deadline.
//!
//! A handshake that never completes used to wait for ever. The user saw a
//! spinner with no way to tell a slow network from a dead one, and the session
//! was never told anything was wrong.
//!
//! There is a budget now, and this is what holds it in place: a server that
//! accepts the connection and then says NOTHING is exactly the hang the
//! budget exists for, and without a test the budget can be removed without
//! anything noticing.
//!
//! The other half is that the budget is PAUSED while a person is typing a
//! password. A person who takes twelve seconds to type is not a hung
//! connection, and a connect that gave up on a slow typist would be the worst
//! possible answer to a prompt that asked for one.

mod common;

use std::time::{Duration, Instant};

use common::*;

use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;

use vnc_core::types::SessionEvent;

/// A server that accepts and then says nothing at all.
///
/// The version negotiation is waiting for twelve bytes that never come, and
/// nothing in the client can tell that from a slow server.
async fn silent_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();
    tokio::spawn(async move {
        // Accept and hold the connection open, reading whatever arrives and
        // never writing a byte.
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut buf = [0u8; 64];
                loop {
                    match stream.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }
                }
            });
        }
    });
    port
}

/// The message the shell shows for a timeout.
fn is_a_timeout(message: &str) -> bool {
    message.contains("did not respond") || message.contains("timed out")
}

#[tokio::test]
async fn a_handshake_that_never_completes_times_out() {
    let port = silent_server().await;
    let mut opts = options(port);
    // A tenth of a second, so the test is quick. The shipping default is
    // forty five seconds and the property under test is the same.
    opts.connect_deadline = Duration::from_millis(150);
    opts.reconnect.enabled = false;

    let started = Instant::now();
    let (_handle, mut events) = spawn_session(opts);

    // The session has to END, and it has to end with a timeout rather than
    // hanging.
    let message = events
        .wait(
            Duration::from_secs(10),
            "the connect to time out",
            |event| match event {
                SessionEvent::Error(message) => Some(message.clone()),
                _ => None,
            },
        )
        .await;
    let elapsed = started.elapsed();

    assert!(
        is_a_timeout(&message),
        "the failure must be a timeout, not something else: {message}"
    );
    assert!(
        elapsed < Duration::from_secs(5),
        "the deadline must end the connect quickly, not after the shipping default: {elapsed:?}"
    );
}

#[tokio::test]
async fn the_deadline_is_not_a_reconnect_loop() {
    // A connect that keeps retrying for ever is the same hang seen from the
    // other side: the user sees a spinner that never stops either.
    //
    // The policy here retries, so the session does not stop and does not
    // report a terminal error. What it must do is say that it is reconnecting
    // and WHY, so the person watching sees a reason rather than a spinner
    // that blinks for ever.
    let port = silent_server().await;
    let mut opts = options(port);
    opts.connect_deadline = Duration::from_millis(120);
    opts.reconnect.initial_delay_ms = 50;
    opts.reconnect.max_delay_ms = 100;

    let (_handle, mut events) = spawn_session(opts);
    let reason = events
        .wait_state(
            Duration::from_secs(10),
            "the session to report a reconnect",
            |state| match state {
                vnc_core::types::SessionState::Reconnecting { reason, .. } => Some(reason.clone()),
                _ => None,
            },
        )
        .await;
    assert!(
        is_a_timeout(&reason),
        "the reconnect must say that the connect ran out of time: {reason}"
    );
}

#[tokio::test]
async fn a_deadline_in_the_past_fails_at_once() {
    // The deadline is not a minimum wait: a zero budget means there is no
    // budget, and the connect must fail rather than proceed.
    let port = silent_server().await;
    let mut opts = options(port);
    opts.connect_deadline = Duration::ZERO;
    opts.reconnect.enabled = false;

    let started = Instant::now();
    let (_handle, mut events) = spawn_session(opts);
    let message = events
        .wait(
            Duration::from_secs(10),
            "the connect to fail",
            |event| match event {
                SessionEvent::Error(message) => Some(message.clone()),
                _ => None,
            },
        )
        .await;
    let elapsed = started.elapsed();

    assert!(is_a_timeout(&message), "unexpected failure: {message}");
    assert!(
        elapsed < Duration::from_secs(5),
        "a zero budget must fail at once, not after a wait: {elapsed:?}"
    );
}

#[tokio::test]
async fn a_timeout_is_not_a_refusal() {
    // The distinction the user reads: a refused connection and a dead one
    // are different sentences, and saying the wrong one sends them looking
    // in the wrong place.
    let port = silent_server().await;
    let mut opts = options(port);
    opts.connect_deadline = Duration::from_millis(120);
    opts.reconnect.enabled = false;

    let (_handle, mut events) = spawn_session(opts);
    let message = events
        .wait(
            Duration::from_secs(10),
            "the connect to fail",
            |event| match event {
                SessionEvent::Error(message) => Some(message.clone()),
                _ => None,
            },
        )
        .await;

    assert!(
        !message.to_lowercase().contains("refused"),
        "a timeout must not be reported as a refusal: {message}"
    );
}
