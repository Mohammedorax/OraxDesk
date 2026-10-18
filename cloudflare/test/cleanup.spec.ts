import { describe, expect, it } from "vitest";
import { sweep } from "../src/cleanup";
import { nowSeconds } from "../src/encoding";
import type { Env } from "../src/env";
import { testBindings, testDb } from "./helpers";

const env = { DB: testDb, INVITATION_KEY: testBindings.INVITATION_KEY } as unknown as Env;
const HOST = "b".repeat(64);
const NONCE = new Uint8Array(12).fill(1);
const HASH = new Uint8Array(32).fill(2);

async function insertCode(code: string, created: number, expires: number, consumed: number | null) {
  await testDb
    .prepare(
      `INSERT INTO signal_codes
         (code, ciphertext, nonce, host_id, auth_nonce, created_at, expires_at, consumed_at, revoke_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(code, new Uint8Array([1]), NONCE, HOST, `nonce-${code}`, created, expires, consumed, HASH)
    .run();
}

describe("cron cleanup", () => {
  it("removes dead rows in bounded batches and keeps live ones", async () => {
    const now = nowSeconds();
    // Dead: expired more than the grace hour ago.
    await insertCode("111111111111", now - 10_000, now - 5_000, null);
    // Dead: consumed more than the grace hour ago.
    await insertCode("222222222222", now - 10_000, now + 300, now - 5_000);
    // Kept: expired but inside the grace window (an in-flight resolve may need it).
    await insertCode("333333333333", now - 10_000, now - 100, null);
    // Kept: live.
    await insertCode("444444444444", now, now + 300, null);

    await testDb
      .prepare("INSERT INTO auth_nonces (nonce, device_id, expires_at) VALUES (?, ?, ?)")
      .bind("a".repeat(22), HOST, now - 1)
      .run();
    await testDb
      .prepare("INSERT INTO auth_nonces (nonce, device_id, expires_at) VALUES (?, ?, ?)")
      .bind("b".repeat(22), HOST, now + 300)
      .run();
    await testDb
      .prepare("INSERT INTO audit_events (at, kind) VALUES (?, ?)")
      .bind(now - 40 * 24 * 3600, "device_registered")
      .run();
    await testDb
      .prepare("INSERT INTO audit_events (at, kind) VALUES (?, ?)")
      .bind(now - 1, "device_registered")
      .run();

    const result = await sweep(env, now);
    expect(result.codes).toBe(2);
    expect(result.nonces).toBe(1);
    expect(result.audit).toBe(1);

    const codes = await testDb
      .prepare("SELECT code FROM signal_codes ORDER BY code")
      .all();
    expect((codes.results as Array<{ code: string }>).map((r) => r.code)).toEqual([
      "333333333333",
      "444444444444",
    ]);
    const nonces = await testDb.prepare("SELECT COUNT(*) AS n FROM auth_nonces").first<{ n: number }>();
    expect(nonces!.n).toBe(1);
    const audit = await testDb.prepare("SELECT COUNT(*) AS n FROM audit_events").first<{ n: number }>();
    expect(audit!.n).toBe(1);

    // A second sweep has nothing left to do.
    const again = await sweep(env, now);
    expect(again).toEqual({ codes: 0, nonces: 0, audit: 0 });
  });
});
