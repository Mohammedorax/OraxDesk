import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { b64urlEncode, nowSeconds } from "../src/encoding";
import {
  freshNonce,
  jsonBody,
  newDevice,
  register,
  signedRequest,
  testDb,
} from "./helpers";


describe("device registration", () => {
  it("registers a device and returns only public fields", async () => {
    const device = await newDevice();
    const response = await register(device);
    expect(response.status).toBe(201);
    const body = await jsonBody<Record<string, unknown>>(response);
    expect(body.id).toBe(device.id);
    expect(body.protocol_version).toBe(1);
    expect(body.revoked_at).toBeNull();
    expect(typeof body.created_at).toBe("number");
    expect(body).not.toHaveProperty("public_key");
    expect(body).not.toHaveProperty("label");
  });

  it("is idempotent for an existing key", async () => {
    const device = await newDevice();
    expect((await register(device)).status).toBe(201);
    const again = await register(device, { label: "Renamed PC" });
    expect(again.status).toBe(200);
    const body = await jsonBody(again);
    expect(body.id).toBe(device.id);
  });

  it("refuses a device id that does not match the key", async () => {
    const device = await newDevice();
    const other = await newDevice();
    const response = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: { public_key: b64urlEncode(device.publicKey) },
        headers: { "x-orax-device": other.id },
      }),
    );
    expect(response.status).toBe(409);
  });

  it("refuses a bad signature", async () => {
    const device = await newDevice();
    const response = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: { public_key: b64urlEncode(device.publicKey) },
        headers: { "x-orax-signature": b64urlEncode(new Uint8Array(64)) },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses a stale timestamp", async () => {
    const device = await newDevice();
    const response = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: { public_key: b64urlEncode(device.publicKey) },
        timestamp: nowSeconds() - 300,
      }),
    );
    expect(response.status).toBe(401);
    // Its own code, because the Rust client auto-corrects its clock off this
    // answer and used to decide by matching the English sentence.
    expect((await jsonBody<{ error: { code: string } }>(response)).error.code).toBe(
      "clock_skew",
    );
  });

  it("refuses a replayed nonce", async () => {
    const device = await newDevice();
    const nonce = freshNonce();
    const first = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: { public_key: b64urlEncode(device.publicKey) },
        nonce,
      }),
    );
    expect(first.status).toBe(201);
    const replay = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: { public_key: b64urlEncode(device.publicKey) },
        nonce,
      }),
    );
    expect(replay.status).toBe(401);
  });

  it("looks a device up publicly and rejects unknown or malformed ids", async () => {
    const device = await newDevice();
    await register(device);
    const found = await SELF.fetch(`https://registry.test/v1/devices/${device.id}`);
    expect(found.status).toBe(200);
    expect((await jsonBody(found)).id).toBe(device.id);

    const missing = await SELF.fetch(`https://registry.test/v1/devices/${"0".repeat(64)}`);
    expect(missing.status).toBe(404);

    const malformed = await SELF.fetch("https://registry.test/v1/devices/not-an-id");
    expect(malformed.status).toBe(400);
  });

  it("revokes only itself and then refuses everything", async () => {
    const device = await newDevice();
    const other = await newDevice();
    await register(device);
    await register(other);

    const wrong = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/revoke`, other, { body: {} }),
    );
    expect(wrong.status).toBe(403);

    const revoked = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/revoke`, device, { body: {} }),
    );
    expect(revoked.status).toBe(204);

    const record = await SELF.fetch(`https://registry.test/v1/devices/${device.id}`);
    expect((await jsonBody(record)).revoked_at).not.toBeNull();

    expect((await register(device)).status).toBe(403);
  });

  it("rejects oversized and non-JSON bodies before touching the journal", async () => {
    const device = await newDevice();
    const oversized = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: { public_key: b64urlEncode(device.publicKey), label: "x".repeat(17 * 1024) },
      }),
    );
    expect(oversized.status).toBe(413);

    const wrongType = await SELF.fetch(
      new Request("https://registry.test/v1/devices", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "cf-connecting-ip": "203.0.113.8",
        },
        body: "{}",
      }),
    );
    expect(wrongType.status).toBe(415);
  });

  it("stores the public key as bytes and the fingerprint as sha256", async () => {
    const device = await newDevice();
    await register(device);
    const row = await testDb.prepare("SELECT public_key, fingerprint FROM devices WHERE id = ?")
      .bind(device.id)
      .first<{ public_key: ArrayBuffer; fingerprint: string }>();
    expect(row).not.toBeNull();
    expect(new Uint8Array(row!.public_key).length).toBe(32);
    expect(row!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
