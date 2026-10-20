// Live smoke test for a deployed Orax registry.
//
//   node scripts/smoke.mjs https://orax-registry.example.workers.dev
//
// It registers a throwaway device, creates two signal codes, resolves one twice
// (the second must fail), revokes the other, then revokes the device so nothing
// is left behind. No third-party dependencies: WebCrypto does the signing.
//
// It also checks the two things that were added last: the SEPARATION of the
// registry key from the identity, and the device DIRECTORY. Both are checked
// against the live deployment rather than only against a unit test, because
// the failure mode of both is "the deployed Worker is not the one that was
// tested".

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base.startsWith("https://") && !base.startsWith("http://localhost")) {
  console.error("usage: node scripts/smoke.mjs https://<worker-url>");
  process.exit(2);
}

const encoder = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const now = () => Math.floor(Date.now() / 1000);

async function sha256Hex(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

// The canonical string the registry verifies.
//
// The ORIGIN is part of what is signed, so a signature captured at one
// registry cannot be replayed at another. The server derives the origin from
// the request it received, and this script has to derive it the same way:
// the scheme and the authority, with the default port left out.
function canonical(method, path, bodyHash, timestamp, nonce) {
  const origin = new URL(base).origin;
  return canonicalFor(origin, method, path, bodyHash, timestamp, nonce);
}

function canonicalFor(origin, method, path, bodyHash, timestamp, nonce) {
  return [
    "orax-device-auth-v2",
    origin,
    method,
    path,
    bodyHash,
    String(timestamp),
    nonce,
  ].join("\n");
}

const failures = [];
function check(name, actual, expected) {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  if (!ok) failures.push(name);
}

const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]));
const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const deviceId = hex(publicKey);

// The registry key: a second key, for the same device, that signs nothing
// but this registry's API calls.
const registryPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]));
const registryPublic = new Uint8Array(await crypto.subtle.exportKey("raw", registryPair.publicKey));

async function signed(method, path, body, origin, keyPair = pair) {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const bodyHash = await sha256Hex(encoder.encode(bodyText));
  const timestamp = now();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      keyPair.privateKey,
      encoder.encode(
        origin
          ? canonicalFor(origin, method, path, bodyHash, timestamp, nonce)
          : canonical(method, path, bodyHash, timestamp, nonce),
      ),
    ),
  );
  const headers = {
    "content-type": "application/json",
    "x-orax-device": deviceId,
    "x-orax-timestamp": String(timestamp),
    "x-orax-nonce": nonce,
    "x-orax-signature": b64url(signature),
  };
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: bodyText === "" ? undefined : bodyText,
  });
}

async function postPublic(path, body) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invitation(seconds = 300) {
  const payload = {
    version: 1,
    address: { id: "a".repeat(64), ip_addrs: [], relay_urls: [] },
    secret: Array.from(crypto.getRandomValues(new Uint8Array(32))),
    expires: now() + seconds,
  };
  return `boundary1:${b64url(encoder.encode(JSON.stringify(payload)))}`;
}

const health = await fetch(`${base}/healthz`);
check("GET /healthz", health.status, 200);
if (health.status !== 200) {
  console.log(await health.text());
}

const register = await signed("POST", "/v1/devices", {
  public_key: b64url(publicKey),
  label: "smoke test",
  client_version: "0.0.0-smoke",
  protocol_version: 1,
});
check("POST /v1/devices", register.status, 201);
const record = await register.json();
check("device id is the key's hex", record.id, deviceId);

const lookup = await fetch(`${base}/v1/devices/${deviceId}`);
check("GET /v1/devices/{id}", lookup.status, 200);
const lookupBody = await lookup.json();
check(
  "the record says when the device was last seen",
  typeof lookupBody.last_seen_at === "number" && lookupBody.last_seen_at > 0,
  true,
);

// The origin is part of what is signed, so a signature made for another
// registry cannot be replayed at this one. This is the property the v2
// canonical string exists for, and it is worth checking against a live
// deployment rather than only against a unit test.
const wrongOrigin = await signed(
  "POST",
  "/v1/signals",
  { invitation: invitation() },
  "https://not-this-registry.example",
);
check("a signature for another origin is refused", wrongOrigin.status, 401);

const first = await signed("POST", "/v1/signals", { invitation: invitation(), ttl_seconds: 300 });
check("POST /v1/signals", first.status, 201);
const firstBody = await first.json();
check("code format", /^\d{12}$/.test(firstBody.code ?? ""), true);

const resolved = await postPublic("/v1/signals/resolve", { code: firstBody.code });
check("POST /v1/signals/resolve", resolved.status, 200);
const resolvedBody = await resolved.json();
check("resolve returns an invitation", String(resolvedBody.invitation).startsWith("boundary1:"), true);

const replayed = await postPublic("/v1/signals/resolve", { code: firstBody.code });
check("second resolve is refused", replayed.status, 404);

const second = await signed("POST", "/v1/signals", { invitation: invitation() });
check("second POST /v1/signals", second.status, 201);
const secondBody = await second.json();

const revokedCode = await postPublic("/v1/signals/revoke", {
  revoke_token: secondBody.revoke_token,
});
check("POST /v1/signals/revoke", revokedCode.status, 204);
const afterRevoke = await postPublic("/v1/signals/resolve", { code: secondBody.code });
check("revoked code cannot resolve", afterRevoke.status, 404);

const revoked = await signed("POST", `/v1/devices/${deviceId}/revoke`, {});
check("POST /v1/devices/{id}/revoke", revoked.status, 204);
const refused = await signed("POST", "/v1/signals", { invitation: invitation() });
check("revoked device is refused", refused.status, 403);

// ---------------------------------------------------------------------------
// The registry key, which is not the identity.
//
// A second device, so the first one's revocation does not get in the way.
const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]));
const otherPublic = new Uint8Array(await crypto.subtle.exportKey("raw", other.publicKey));
const otherId = hex(otherPublic);
const otherRegistry = (
  await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
);
const secondRegistryPublic = new Uint8Array(
  await crypto.subtle.exportKey("raw", otherRegistry.publicKey),
);

async function signedAs(keyPair, method, path, body, device = deviceId) {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const bodyHash = await sha256Hex(encoder.encode(bodyText));
  const timestamp = now();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      keyPair.privateKey,
      encoder.encode(canonical(method, path, bodyHash, timestamp, nonce)),
    ),
  );
  return fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-orax-device": device,
      "x-orax-timestamp": String(timestamp),
      "x-orax-nonce": nonce,
      "x-orax-signature": b64url(signature),
    },
    body: bodyText === "" ? undefined : bodyText,
  });
}

const separated = await signedAs(
  other,
  "POST",
  "/v1/devices",
  {
    public_key: b64url(otherPublic),
    registry_key: b64url(secondRegistryPublic),
    label: "smoke test, separated",
    client_version: "0.0.0-smoke",
    protocol_version: 1,
  },
  otherId,
);
check("a device can register with a registry key", separated.status, 201);

const withRegistryKey = await signedAs(
  otherRegistry,
  "POST",
  "/v1/signals",
  { invitation: invitation() },
  otherId,
);
check("a call signed with the registry key is accepted", withRegistryKey.status, 201);

const withIdentity = await signedAs(other, "POST", "/v1/signals", { invitation: invitation() }, otherId);
check("a call signed with the identity is refused once a registry key exists", withIdentity.status, 401);

// The same key twice is the state the separation exists to end.
const duplicated = await signedAs(
  other,
  "POST",
  "/v1/devices",
  {
    public_key: b64url(otherPublic),
    registry_key: b64url(otherPublic),
    label: "smoke test, duplicated",
    client_version: "0.0.0-smoke",
    protocol_version: 1,
  },
  otherId,
);
check("a registry key that IS the identity is refused", duplicated.status, 400);

// ---------------------------------------------------------------------------
// The device directory.
const address = {
  id: otherId,
  addrs: [{ Ip: "192.0.2.10:41641" }, { Relay: "https://relay.example/" }],
};
const published = await signedAs(
  otherRegistry,
  "POST",
  `/v1/devices/${otherId}/address`,
  { address },
  otherId,
);
check("POST /v1/devices/{id}/address", published.status, 204);

const readBack = await fetch(`${base}/v1/devices/${otherId}/address`);
check("GET /v1/devices/{id}/address", readBack.status, 200);
const addressBody = await readBack.json();
check("the address reads back as published", JSON.stringify(addressBody), JSON.stringify(address));

// A secret-shaped field inside an address is refused, because a registry that
// accepts one ends up holding one.
const withSecret = await signedAs(
  otherRegistry,
  "POST",
  `/v1/devices/${otherId}/address`,
  { address: { ...address, secret: Array.from(new Uint8Array(32)) } },
  otherId,
);
check("an address carrying a secret is refused", withSecret.status, 400);

// An address for a different device is refused.
const forAnother = await signedAs(
  otherRegistry,
  "POST",
  `/v1/devices/${otherId}/address`,
  { address: { id: deviceId, addrs: [{ Ip: "192.0.2.11:41641" }] } },
  otherId,
);
check("an address for another device is refused", forAnother.status, 409);

const secondRevoked = await signedAs(
  otherRegistry,
  "POST",
  `/v1/devices/${otherId}/revoke`,
  {},
  otherId,
);
check("the second device is revoked too", secondRevoked.status, 204);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall live checks passed");
