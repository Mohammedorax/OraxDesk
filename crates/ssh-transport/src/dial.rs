//! An injected way to reach the SSH server.
//!
//! The carrier dials `host:port` itself by default. When the person has
//! chosen a SOCKS5 proxy, the shell attaches a [`Dialer`] to [`crate::SshConfig`]
//! and the handshake runs over the stream that dialer returns instead. The
//! seam lives here, in the carrier, because everything above it — the PTY,
//! the `direct-tcpip` tunnel, SFTP — should not know how the socket was
//! obtained; and it is deliberately shaped like
//! `vnc_transport::StreamConnector` so `ssh-core` can adapt one to the
//! other, keeping the one proxy implementation in `vnc-transport` where VNC
//! and RDP already use it.
//!
//! The dialer receives the *configured* host and port, not a resolved
//! address: a SOCKS5 proxy resolves the name at the proxy end (RFC 1928's
//! domain address type), which is the whole point when the name is only
//! meaningful inside the remote network.

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite};

use crate::error::Result;

/// A byte stream an SSH handshake can run over.
///
/// A named trait rather than a bare `dyn AsyncRead + AsyncWrite + ...`:
/// Rust allows only one non-auto trait in a trait object, so the supertraits
/// are gathered here (the same shape as `vnc_transport::Stream`).
pub trait DialedIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> DialedIo for T {}

pub type DialedStream = Pin<Box<dyn DialedIo>>;

/// A boxed dial future, the shape [`Dialer`] implementations return
/// (object-safe async without an `async_trait` dependency).
pub type DialFuture<'a> =
    Pin<Box<dyn std::future::Future<Output = Result<DialedStream>> + Send + 'a>>;

/// An alternative way of opening the TCP stream the SSH carrier runs over.
///
/// `timeout` is the dial budget for the whole attempt, so an implementation
/// that performs several round trips (a SOCKS5 greeting plus a CONNECT) can
/// hold itself to one deadline instead of multiplying it.
pub trait Dialer: Send + Sync {
    fn dial(&self, host: &str, port: u16, timeout: Duration) -> DialFuture<'_>;

    /// Short, secret-free label for logs and error messages.
    fn describe(&self) -> String {
        "custom dialer".to_string()
    }
}

/// The dialer carried on a config, boxed so [`crate::SshConfig`] stays `Clone`
/// and cheap to hand to a reconnect loop.
#[derive(Clone)]
pub struct DialerHandle(pub Arc<dyn Dialer>);

impl DialerHandle {
    pub fn describe(&self) -> String {
        self.0.describe()
    }
}

impl std::fmt::Debug for DialerHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("DialerHandle")
            .field(&self.describe())
            .finish()
    }
}
