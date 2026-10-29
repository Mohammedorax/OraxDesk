import { SELF, env as testEnv } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { revokeDeviceAsOperator } from "../src/devices";
import type { Env } from "../src/env";
import {
  createSignal,
  jsonBody,
  makeInvitation,
  newDevice,
  register,
  testDb,
} from "./helpers";

const TOKEN = "test-operator-token-0123456789";

function operatorRevoke(id: string, token: string | null = TOKEN, body: unknown = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cf-connecting-ip": "203.0.113.20",
  };
  if (token !== null) headers["x-orax-operator"] = token;
  return SELF.fetch(
    new Request(`https://registry.test/v1/admin/devices/${id}/revoke`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("operator revocation", () => {
  it("revokes a device from the server side, and the device cannot come back", async () => {
    const device = await newDevice();
    await register(device);
    const created = await createSignal(device, makeInvitation());
    expect(created.status).toBe(201);

    const revoked = await operatorRevoke(device.id, TOKEN, { reason: "stolen" });
    expect(revoked.status).toBe(204);

    // Pending codes must not outlive the revocation.
    const codes = await testDb
      .prepare("SELECT COUNT(*) AS n FROM signal_codes WHERE host_id = ?")
      .bind(device.id)
      .first<{ n: number }>();
    expect(codes!.n).toBe(0);

    // The row is a tombstone: registration is refused, so a machine holding
    // the identity key cannot simply register itself again.
    const row = await testDb
      .prepare("SELECT revoked_at, registry_key FROM devices WHERE id = ?")
      .bind(device.id)
      .first<{ revoked_at: number | null; registry_key: ArrayBuffer | null }>();
    expect(row!.revoked_at).not.toBeNull();
    expect(row!.registry_key).toBeNull();
    expect((await register(device)).status).toBe(403);
  });

  it("is idempotent", async () => {
    const device = await newDevice();
    await register(device);
    expect((await operatorRevoke(device.id)).status).toBe(204);
    expect((await operatorRevoke(device.id)).status).toBe(204);
  });

  it("refuses a missing or wrong token, and changes nothing", async () => {
    const device = await newDevice();
    await register(device);

    expect((await operatorRevoke(device.id, null)).status).toBe(401);
    expect((await operatorRevoke(device.id, "not-the-token")).status).toBe(401);

    const row = await testDb
      .prepare("SELECT revoked_at FROM devices WHERE id = ?")
      .bind(device.id)
      .first<{ revoked_at: number | null }>();
    expect(row!.revoked_at).toBeNull();
  });

  it("answers 404 for a device that does not exist", async () => {
    const response = await operatorRevoke("a".repeat(64));
    expect(response.status).toBe(404);
    const body = await jsonBody<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("not_found");
  });

  it("does not exist at all when the deployment has no operator token", async () => {
    const device = await newDevice();
    await register(device);
    // The same handler with the binding removed: this is the production
    // default, where remote administration must not be reachable.
    const withoutOperator = {
      DB: testEnv.DB,
      INVITATION_KEY: testEnv.INVITATION_KEY,
    } as Env;
    const request = new Request(
      `https://registry.test/v1/admin/devices/${device.id}/revoke`,
      {
        method: "POST",
        headers: { "x-orax-operator": TOKEN, "content-type": "application/json" },
        body: "{}",
      },
    );
    await expect(
      revokeDeviceAsOperator(withoutOperator, request, device.id, {}),
    ).rejects.toMatchObject({ status: 404 });
  });
});
