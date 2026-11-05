use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::socks5::Socks5Connector;
use crate::{StreamConnector, TransportError};

#[tokio::test]
async fn domain_is_resolved_by_proxy_and_stream_remains_usable() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0; 3];
        stream.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 1, 0]);
        stream.write_all(&[5, 0]).await.unwrap();
        let mut request = [0; 4];
        stream.read_exact(&mut request).await.unwrap();
        assert_eq!(request, [5, 1, 0, 3]);
        let length = stream.read_u8().await.unwrap();
        let mut host = vec![0; usize::from(length)];
        stream.read_exact(&mut host).await.unwrap();
        assert_eq!(host, b"remote.invalid");
        assert_eq!(stream.read_u16().await.unwrap(), 5900);
        stream
            .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 1])
            .await
            .unwrap();
        stream.write_all(b"RFB").await.unwrap();
    });
    let connector = Socks5Connector::new("127.0.0.1", port);
    let mut stream = connector
        .connect("remote.invalid", 5900, Duration::from_secs(3))
        .await
        .unwrap();
    let mut banner = [0; 3];
    stream.read_exact(&mut banner).await.unwrap();
    assert_eq!(&banner, b"RFB");
    server.await.unwrap();
}

#[tokio::test]
async fn a_probe_stops_after_the_greeting() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0; 3];
        stream.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 1, 0]);
        stream.write_all(&[5, 0]).await.unwrap();
        let mut byte = [0];
        assert_eq!(stream.read(&mut byte).await.unwrap(), 0);
    });
    Socks5Connector::new("127.0.0.1", port)
        .probe(Duration::from_secs(3))
        .await
        .unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn unsupported_authentication_never_sends_connect_request() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0; 3];
        stream.read_exact(&mut greeting).await.unwrap();
        stream.write_all(&[5, 2]).await.unwrap();
        let mut byte = [0];
        assert_eq!(stream.read(&mut byte).await.unwrap(), 0);
    });
    let connector = Socks5Connector::new("127.0.0.1", port);
    assert!(connector
        .connect("remote.invalid", 5900, Duration::from_secs(3))
        .await
        .is_err());
    server.await.unwrap();
}

#[tokio::test]
async fn stalled_proxy_handshake_obeys_the_whole_connect_budget() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0; 3];
        stream.read_exact(&mut greeting).await.unwrap();
        let mut byte = [0];
        assert_eq!(stream.read(&mut byte).await.unwrap(), 0);
    });
    let connector = Socks5Connector::new("127.0.0.1", port);
    let result = connector
        .connect("remote.invalid", 5900, Duration::from_millis(100))
        .await;
    assert!(matches!(result, Err(TransportError::Timeout)));
    server.await.unwrap();
}
