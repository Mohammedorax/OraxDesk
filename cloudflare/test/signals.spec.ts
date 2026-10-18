import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nowSeconds } from "../src/encoding";
import {
  createSignal,
  freshNonce,
  jsonBody,
  makeInvitation,
  newDevice,
  register,
  resolveSignal,
  signedRequest,
  testDb,
} from "./helpers";


async function registeredDevice() {
  const device = await newDevice();
  expect((await register(device)).status).toBe(201);
  return device;
}

describe("signal codes", () => {
  it("creates a 12 digit code, resolves it once, and returns the same invitation", async () => {
    const device = await registeredDevice();
    const invitation = makeInvitation();
    const created = await createSignal(device, invitation);
    expect(created.status).toBe(201);
    const { code, expires_at, revoke_token } = await jsonBody<{
      code: string;
      expires_at: number;
      revoke_token: string;
    }>(created);
    expect(code).toMatch(/^\d{12}$/);
    expect(expires_at).toBeGreaterThan(nowSeconds());
    expect(revoke_token).toMatch(/^[0-9a-f]{64}$/);

    const resolved = await resolveSignal(code);
    expect(resolved.status).toBe(200);
    expect((await jsonBody<{ invitation: string }>(resolved)).invitation).toBe(invitation);

    const second = await resolveSignal(code);
    expect(second.status).toBe(404);
  });

  it("returns the same code when the create request is retried with its nonce", async () => {
    const device = await registeredDevice();
    const invitation = makeInvitation();
    const nonce = freshNonce();
    const first = await createSignal(device, invitation, {}, nonce);
    expect(first.status).toBe(201);
    const firstBody = await jsonBody<{ code: string }>(first);

    const retry = await createSignal(device, invitation, {}, nonce);
    expect(retry.status).toBe(200);
    expect((await jsonBody<{ code: string }>(retry)).code).toBe(firstBody.code);

    const rows = await testDb.prepare(
      "SELECT COUNT(*) AS n FROM signal_codes WHERE host_id = ?",
    )
      .bind(device.id)
      .first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it("never stores the invitation or the revoke token in the clear", async () => {
    const device = await registeredDevice();
    const invitation = makeInvitation();
    const created = await createSignal(device, invitation);
    const { code, revoke_token } = await jsonBody<{ code: string; revoke_token: string }>(created);

    const row = await testDb.prepare(
      "SELECT ciphertext, nonce, revoke_hash FROM signal_codes WHERE code = ?",
    )
      .bind(code)
      .first<{ ciphertext: ArrayBuffer; nonce: ArrayBuffer; revoke_hash: ArrayBuffer }>();
    const ciphertext = new Uint8Array(row!.ciphertext);
    expect(new Uint8Array(row!.nonce).length).toBe(12);
    expect(new Uint8Array(row!.revoke_hash).length).toBe(32);
    // The sealed bytes must not contain the plaintext prefix anywhere.
    const asText = new TextDecoder().decode(ciphertext);
    expect(asText).not.toContain("boundary1:");
    expect(asText).not.toContain(invitation.slice(10, 30));
    expect(revoke_token).not.toBe("");
  });

  it("revokes a pending code and is idempotent", async () => {
    const device = await registeredDevice();
    const created = await createSignal(device, makeInvitation());
    const { code, revoke_token } = await jsonBody<{ code: string; revoke_token: string }>(created);

    const revoke = (token: string) =>
      SELF.fetch(
        new Request("https://registry.test/v1/signals/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ revoke_token: token }),
        }),
      );

    expect((await revoke(revoke_token)).status).toBe(204);
    expect((await revoke(revoke_token)).status).toBe(204);
    expect((await resolveSignal(code)).status).toBe(404);
    expect((await revoke("not-hex")).status).toBe(400);
  });

  it("refuses expired and tampered rows", async () => {
    const device = await registeredDevice();
    const invitation = makeInvitation();

    // Expired: the guarded UPDATE must not consume it.
    const expired = await createSignal(device, invitation);
    const expiredCode = (await jsonBody<{ code: string }>(expired)).code;
    await testDb.prepare(
      "UPDATE signal_codes SET created_at = ?, expires_at = ? WHERE code = ?",
    )
      .bind(nowSeconds() - 3600, nowSeconds() - 1, expiredCode)
      .run();
    expect((await resolveSignal(expiredCode)).status).toBe(404);

    // Tampered ciphertext: fails closed with 404, never 500.
    const tampered = await createSignal(device, invitation);
    const tamperedCode = (await jsonBody<{ code: string }>(tampered)).code;
    await testDb.prepare("UPDATE signal_codes SET ciphertext = ? WHERE code = ?")
      .bind(new Uint8Array([1, 2, 3, 4]), tamperedCode)
      .run();
    expect((await resolveSignal(tamperedCode)).status).toBe(404);
  });

  it("lets exactly one of two concurrent resolves win", async () => {
    const device = await registeredDevice();
    const created = await createSignal(device, makeInvitation());
    const code = (await jsonBody<{ code: string }>(created)).code;

    const [first, second] = await Promise.all([resolveSignal(code), resolveSignal(code)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 404]);
  });

  it("validates the invitation envelope before storing anything", async () => {
    const device = await registeredDevice();
    const cases: Array<[string, string]> = [
      ["not an invitation", "hello"],
      ["wrong prefix", "boundary2:" + makeInvitation().slice(10)],
      ["expired", makeInvitation(-10)],
      ["version 2", makeInvitation(300, 2)],
    ];
    for (const [name, invitation] of cases) {
      const response = await createSignal(device, invitation);
      expect(response.status, name).toBe(400);
    }
  });

  it("stops a device that mints more than 20 codes an hour", async () => {
    const device = await registeredDevice();
    const invitation = makeInvitation();
    for (let i = 0; i < 20; i += 1) {
      const response = await createSignal(device, invitation);
      expect(response.status).toBe(201);
    }
    const blocked = await createSignal(device, invitation);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("600");
  });

  it("refuses codes from an unregistered or revoked device", async () => {
    const stranger = await newDevice();
    expect((await createSignal(stranger, makeInvitation())).status).toBe(401);

    const device = await registeredDevice();
    await SELF.fetch(await signedRequest(`/v1/devices/${device.id}/revoke`, device, { body: {} }));
    expect((await createSignal(device, makeInvitation())).status).toBe(403);
  });

  it("drops pending codes when the device is revoked", async () => {
    const device = await registeredDevice();
    const created = await createSignal(device, makeInvitation());
    const code = (await jsonBody<{ code: string }>(created)).code;

    await SELF.fetch(await signedRequest(`/v1/devices/${device.id}/revoke`, device, { body: {} }));
    const rows = await testDb.prepare("SELECT COUNT(*) AS n FROM signal_codes WHERE host_id = ?")
      .bind(device.id)
      .first<{ n: number }>();
    expect(rows!.n).toBe(0);
    expect((await resolveSignal(code)).status).toBe(404);
  });
});
