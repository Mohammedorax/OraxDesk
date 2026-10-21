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
      .bind(now - 40 * 24 * 3600, "device.registered")
      .run();
    await testDb
      .prepare("INSERT INTO audit_events (at, kind) VALUES (?, ?)")
      .bind(now - 1, "device.registered")
      .run();
    // A device with an address that expired an hour ago, and one with a
    // fresh address.
    await insertDevice("aa", now - 2 * 3600, now - 2 * 3600);
    await insertDevice("bb", now, now);

    const result = await sweep(env, now);
    expect(result.codes).toBe(2);
    expect(result.nonces).toBe(1);
    expect(result.audit).toBe(1);
    expect(result.addresses).toBe(1);

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
    // The expired address is cleared and the fresh one is kept.
    const addresses = await testDb
      .prepare("SELECT id, address FROM devices ORDER BY id")
      .all();
    expect(
      (addresses.results as Array<{ id: string; address: string | null }>).map((r) => [
        r.id,
        r.address,
      ]),
    ).toEqual([
      [deviceId("aa"), null],
      [deviceId("bb"), JSON.stringify({ id: deviceId("bb"), addrs: [] })],
    ]);

    // A second sweep has nothing left to do.
    const again = await sweep(env, now);
    expect(again).toEqual({ codes: 0, nonces: 0, audit: 0, addresses: 0, devices: 0 });
  });

  it("removes a device nobody has heard from in a week", async () => {
    const now = nowSeconds();
    await insertDevice("cc", now - 8 * 24 * 3600, null);
    await insertDevice("dd", now - 60, null);

    const result = await sweep(env, now);
    expect(result.devices).toBe(1);

    // Scoped to the two rows this test made: the table is shared with the
    // other tests in this file, and a test that asserts on the whole table
    // depends on what ran before it.
    const left = await testDb
      .prepare("SELECT id FROM devices WHERE id IN (?, ?) ORDER BY id")
      .bind(deviceId("cc"), deviceId("dd"))
      .all();
    expect((left.results as Array<{ id: string }>).map((r) => r.id)).toEqual([deviceId("dd")]);
  });
});

/**
 * The id a test device is stored under.
 *
 * It is 64 hex characters, because the schema says so: the id IS the device's
 * public key in hex, and nothing else is accepted.
 */
function deviceId(name: string): string {
  return name.padEnd(64, "0").slice(0, 64);
}

/** A device row, with an address published at `addressAt`. */
async function insertDevice(name: string, lastSeen: number | null, addressAt: number | null) {
  const id = deviceId(name);
  await testDb
    .prepare(
      `INSERT INTO devices
         (id, public_key, fingerprint, number, created_at, updated_at, last_seen_at, address, address_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      // The public key is UNIQUE too: it is the device's identity and two
      // rows with the same one are the same device.
      new Uint8Array(32).fill(3 + name.charCodeAt(0)),
      "f".repeat(64),
      // The nine digit number is UNIQUE and all digits, so each test device
      // gets its own.
      String(100000000 + name.charCodeAt(0)),
      nowSeconds(),
      nowSeconds(),
      lastSeen,
      addressAt === null ? null : JSON.stringify({ id, addrs: [] }),
      addressAt,
    )
    .run();
}
