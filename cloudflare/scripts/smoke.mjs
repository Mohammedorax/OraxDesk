// Live smoke test for a deployed Orax registry.
//
//   node scripts/smoke.mjs https://orax-registry.example.workers.dev
//
// It registers a throwaway device, creates two signal codes, resolves one twice
// (the second must fail), revokes the other, then revokes the device so nothing
// is left behind. No third-party dependencies: WebCrypto does the signing.

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

function canonical(method, path, bodyHash, timestamp, nonce) {
  return ["orax-device-auth-v1", method, path, bodyHash, String(timestamp), nonce].join("\n");
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

async function signed(method, path, body) {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const bodyHash = await sha256Hex(encoder.encode(bodyText));
  const timestamp = now();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      pair.privateKey,
      encoder.encode(canonical(method, path, bodyHash, timestamp, nonce)),
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

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall live checks passed");
