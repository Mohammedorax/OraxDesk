//! SOCKS5 (RFC 1928) `CONNECT`, for reaching a machine through a proxy.
//!
//! This is a [`StreamConnector`], not a change to [`crate::tcp`]: the proxy is
//! the user's choice and the carrier the session runs over, which is exactly
//! the seam the trait exists for. The host is sent as a **domain name**
//! (`ATYP = 3`) so the proxy resolves and dials it, never this machine: a
//! proxy that only worked for names the client can already resolve would be
//! pointless for the case this is for (a machine only the proxy can see).
//!
//! Only `METHOD 0x00` (no authentication) is offered. A proxy demanding
//! username/password is refused with a sentence rather than silently sent a
//! credential the user never entered, and the refusal arrives **before** any
//! `CONNECT` request goes out.
//!
//! The whole exchange — dialling the proxy, greeting, authenticating, the
//! request and its reply — is bounded by the single `timeout` the session
//! passes in, because that is the connect budget the user is waiting on.

use std::io;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::{BoxedStream, ConnectFuture, StreamConnector, TransportError};

const SOCKS5: u8 = 0x05;
const METHOD_NO_AUTH: u8 = 0x00;
const CMD_CONNECT: u8 = 0x01;
const ATYP_DOMAIN: u8 = 0x03;
const REPLY_SUCCEEDED: u8 = 0x00;

/// A SOCKS5 proxy to dial an RFB endpoint through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Socks5Connector {
    proxy_host: String,
    proxy_port: u16,
}

impl Socks5Connector {
    /// The proxy's own address, as the user typed it.
    #[must_use]
    pub fn new(proxy_host: impl Into<String>, proxy_port: u16) -> Self {
        Self {
            proxy_host: proxy_host.into(),
            proxy_port,
        }
    }

    /// Ask the proxy whether it speaks SOCKS5 and accepts a connection with
    /// no authentication.
    ///
    /// This stops after the greeting (RFC 1928 §3). It does not send a
    /// `CONNECT`, so it says nothing about whether a particular machine is
    /// reachable through the proxy — only that the proxy itself answered and
    /// did not demand a credential this client will not send.
    pub async fn probe(&self, timeout: Duration) -> Result<(), TransportError> {
        tokio::time::timeout(timeout, greet(&self.proxy_host, self.proxy_port))
            .await
            .map_err(|_| TransportError::Timeout)??;
        Ok(())
    }
}

impl StreamConnector for Socks5Connector {
    fn connect(&self, host: &str, port: u16, timeout: Duration) -> ConnectFuture<'_> {
        // Everything the future needs is owned before it is boxed: the trait's
        // output lifetime is the `&self` borrow, which is not where `host`
        // lives (RFC 1928 says nothing, Rust does).
        let host = host.to_string();
        let proxy_host = self.proxy_host.clone();
        let proxy_port = self.proxy_port;
        Box::pin(async move {
            let stream =
                tokio::time::timeout(timeout, negotiate(&host, port, &proxy_host, proxy_port))
                    .await
                    .map_err(|_| TransportError::Timeout)??;
            let boxed: BoxedStream = Box::pin(stream);
            Ok(boxed)
        })
    }

    fn describe(&self) -> String {
        format!("socks5 via {}:{}", self.proxy_host, self.proxy_port)
    }
}

/// Dial the proxy and complete the no-authentication greeting.
///
/// The returned stream is positioned where a `CONNECT` request would go.
/// Dropping it here is how a caller refuses to continue: nothing past the
/// greeting has been sent (RFC 1928 §3).
async fn greet(proxy_host: &str, proxy_port: u16) -> Result<TcpStream, TransportError> {
    let proxy = format!("{proxy_host}:{proxy_port}");
    let mut stream = TcpStream::connect((proxy_host, proxy_port))
        .await
        .map_err(|e| match e.kind() {
            io::ErrorKind::ConnectionRefused => TransportError::Refused(proxy.clone()),
            _ => TransportError::Io(e),
        })?;

    // Greeting: one method, no authentication.
    stream
        .write_all(&[SOCKS5, 1, METHOD_NO_AUTH])
        .await
        .map_err(TransportError::Io)?;
    let mut choice = [0u8; 2];
    stream
        .read_exact(&mut choice)
        .await
        .map_err(TransportError::Io)?;
    if choice[0] != SOCKS5 {
        return Err(protocol(format!(
            "the proxy answered greeting version {}, not SOCKS5 (RFC 1928 §3)",
            choice[0]
        )));
    }
    if choice[1] != METHOD_NO_AUTH {
        // Drop the stream here: nothing after this point is sent, so a proxy
        // asking for a credential the user never gave gets no credential and
        // no CONNECT request either (RFC 1928 §3).
        return Err(protocol(format!(
            "the proxy requires authentication method {}, which this client does not offer; only no-authentication proxies are supported",
            choice[1]
        )));
    }
    Ok(stream)
}

/// Dial the proxy and run the SOCKS5 handshake for one target.
async fn negotiate(
    host: &str,
    port: u16,
    proxy_host: &str,
    proxy_port: u16,
) -> Result<TcpStream, TransportError> {
    let mut stream = greet(proxy_host, proxy_port).await?;

    // CONNECT, with the target as a domain name so the proxy resolves it.
    let name = host.as_bytes();
    let name_len = u8::try_from(name.len()).map_err(|_| {
        protocol(format!(
            "the machine's name is {} bytes long; SOCKS5 carries at most 255",
            name.len()
        ))
    })?;
    let mut request = Vec::with_capacity(7 + name.len());
    request.extend_from_slice(&[SOCKS5, CMD_CONNECT, 0, ATYP_DOMAIN, name_len]);
    request.extend_from_slice(name);
    request.extend_from_slice(&port.to_be_bytes());
    stream
        .write_all(&request)
        .await
        .map_err(TransportError::Io)?;

    // Reply: VER, REP, RSV, ATYP, then the bound address (which we consume and
    // do not use) and its port.
    let mut head = [0u8; 4];
    stream
        .read_exact(&mut head)
        .await
        .map_err(TransportError::Io)?;
    if head[0] != SOCKS5 {
        return Err(protocol(format!(
            "the proxy answered reply version {}, not SOCKS5 (RFC 1928 §6)",
            head[0]
        )));
    }
    if head[1] != REPLY_SUCCEEDED {
        return Err(protocol(format!(
            "the proxy refused the connection: {} (RFC 1928 §6)",
            reply_text(head[1])
        )));
    }
    match head[3] {
        0x01 => {
            let mut rest = [0u8; 4 + 2];
            stream
                .read_exact(&mut rest)
                .await
                .map_err(TransportError::Io)?;
        }
        0x04 => {
            let mut rest = [0u8; 16 + 2];
            stream
                .read_exact(&mut rest)
                .await
                .map_err(TransportError::Io)?;
        }
        ATYP_DOMAIN => {
            let len = stream.read_u8().await.map_err(TransportError::Io)?;
            let mut rest = vec![0u8; usize::from(len) + 2];
            stream
                .read_exact(&mut rest)
                .await
                .map_err(TransportError::Io)?;
        }
        other => {
            return Err(protocol(format!(
                "the proxy replied with address type {other}, which RFC 1928 does not define"
            )))
        }
    }
    Ok(stream)
}

/// A handshake that does not follow RFC 1928, as an I/O error a caller already
/// knows how to report.
fn protocol(sentence: String) -> TransportError {
    TransportError::Io(io::Error::new(io::ErrorKind::InvalidData, sentence))
}

/// The `REP` field's meanings (RFC 1928 §6), so a refusal names its reason.
fn reply_text(reply: u8) -> &'static str {
    match reply {
        0x01 => "general failure",
        0x02 => "connection not allowed by ruleset",
        0x03 => "network unreachable",
        0x04 => "host unreachable",
        0x05 => "connection refused",
        0x06 => "TTL expired",
        0x07 => "command not supported",
        0x08 => "address type not supported",
        _ => "unassigned reply code",
    }
}
