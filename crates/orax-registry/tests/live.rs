//! Live integration against a *deployed* registry.
//!
//! Ignored by default so `cargo test` stays offline and hermetic. Run it when a
//! Worker is deployed:
//!
//! ```sh
//! ORAX_REGISTRY_URL=https://orax-registry.example.workers.dev \
//!   cargo test -p orax-registry --test live -- --ignored --nocapture
//! ```
//!
//! It registers a throwaway device, publishes one invitation, resolves it once,
//! checks single use, then revokes the device so nothing is left behind.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use iroh::SecretKey;
use orax_registry::{Client, DeviceKeys, Error};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

fn invitation(seconds_ahead: u64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_secs();
    let secret: Vec<u8> = (0..32).collect();
    let payload = json!({
        "version": 1,
        "address": { "id": "a".repeat(64), "ip_addrs": [], "relay_urls": [] },
        "secret": secret,
        "expires": now + seconds_ahead,
    });
    let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).expect("serialise"));
    format!("boundary1:{encoded}")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs a deployed registry; set ORAX_REGISTRY_URL"]
async fn live_registry_round_trip() {
    let url = std::env::var("ORAX_REGISTRY_URL")
        .expect("set ORAX_REGISTRY_URL to a deployed Worker origin");
    let client = Client::new(&url).expect("valid registry url");

    let health = client.health().await.expect("registry health");
    assert_eq!(health.status, "ok", "health: {health:?}");
    assert_eq!(health.api, "v1");
    println!("health ok: {url}");

    // A fresh key is a fresh device; nothing is shared with any other run.
    //
    // TWO keys: the identity, which is the device's id, and the registry key,
    // which is what the API calls are signed with. The point of the pair is
    // that the identity is trusted by every machine that ever paired with
    // this one, so a leak of it is a leak of all of them.
    let identity = SecretKey::generate();
    let registry = SecretKey::generate();
    let id = orax_registry::device_id(&identity);
    let keys = DeviceKeys::new(identity, registry).expect("the two keys must differ");
    let record = client
        .register(&keys, Some("rust live test"), "live-test")
        .await
        .expect("register");
    assert_eq!(record.id, id);
    assert!(record.revoked_at.is_none());

    // Registering again is idempotent.
    let again = client
        .register(&keys, Some("rust live test"), "live-test")
        .await
        .expect("re-register");
    assert_eq!(again.id, id);

    let printed = invitation(300);
    let code = client
        .create_signal(&keys, &printed, 120)
        .await
        .expect("create signal");
    assert_eq!(code.code.len(), 12);
    assert!(code.expires_at > 0);
    println!("code: {}", code.code);

    let resolved = client.resolve_signal(&code.code).await.expect("resolve");
    assert_eq!(
        resolved, printed,
        "the invitation must survive storage unchanged"
    );

    match client.resolve_signal(&code.code).await {
        Err(Error::Api { status: 404, .. }) => {}
        other => panic!("a used code must be 404, got {other:?}"),
    }

    // Revocation is the cleanup path: the device and its codes disappear.
    client.revoke(&keys).await.expect("revoke");
    let record = client.lookup(&id).await.expect("lookup after revoke");
    assert!(record.revoked_at.is_some(), "device must read as revoked");

    println!("live round trip ok, device revoked: {id}");
}
