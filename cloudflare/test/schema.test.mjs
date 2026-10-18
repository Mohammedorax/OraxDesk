// Offline schema tests for the Orax registry (phase P2).
//
// These run against a real SQLite engine through `node:sqlite`, applying the
// same migration file D1 will apply. They are deliberately dependency-free so
// they can run before `npm install` and in environments without network access.
// The Worker-level API tests in P3 use the D1 emulation behind vitest.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATION_PATH = fileURLToPath(
  new URL("../migrations/0001_init.sql", import.meta.url),
);
const MIGRATION = readFileSync(MIGRATION_PATH, "utf8");

const CODE = "123456789012";
const HOST_ID = "b".repeat(64);
const OTHER_HOST_ID = "c".repeat(64);
const KEY = Buffer.alloc(32, 7);
const NONCE = Buffer.alloc(12, 1);
const HASH = Buffer.alloc(32, 2);
const FINGERPRINT = "a".repeat(64);
const NOW = 1_000_000;

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATION);
  return db;
}

function insertDevice(db, overrides = {}) {
  const row = {
    id: HOST_ID,
    public_key: KEY,
    fingerprint: FINGERPRINT,
    label: "Reception PC",
    client_version: "0.30.0",
    protocol_version: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO devices
       (id, public_key, fingerprint, label, client_version, protocol_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.public_key,
    row.fingerprint,
    row.label,
    row.client_version,
    row.protocol_version,
    row.created_at,
    row.updated_at,
  );
  return row;
}

function insertCode(db, overrides = {}) {
  const row = {
    code: CODE,
    ciphertext: Buffer.from("sealed-invitation-bytes"),
    nonce: NONCE,
    host_id: HOST_ID,
    auth_nonce: "nonce-0000000001",
    created_at: NOW,
    expires_at: NOW + 600,
    consumed_at: null,
    revoke_hash: HASH,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO signal_codes
       (code, ciphertext, nonce, host_id, auth_nonce, created_at, expires_at, consumed_at, revoke_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.code,
    row.ciphertext,
    row.nonce,
    row.host_id,
    row.auth_nonce,
    row.created_at,
    row.expires_at,
    row.consumed_at,
    row.revoke_hash,
  );
  return row;
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
}

function indexNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .all()
    .map((row) => row.name);
}

// --- migrations ------------------------------------------------------------

test("migration applies and is safe to re-run", () => {
  const db = open();
  db.exec(MIGRATION); // second application must be a no-op, not an error

  const version = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
    .get();
  assert.equal(version.value, "1");

  const tables = tableNames(db);
  for (const table of [
    "devices",
    "signal_codes",
    "auth_nonces",
    "audit_events",
    "schema_meta",
  ]) {
    assert.ok(tables.includes(table), `missing table ${table}`);
  }

  const indexes = indexNames(db);
  for (const index of [
    "devices_public_key_idx",
    "devices_revoked_idx",
    "devices_last_seen_idx",
    "signal_codes_expiry_idx",
    "signal_codes_host_idx",
    "auth_nonces_expiry_idx",
    "audit_events_at_idx",
  ]) {
    assert.ok(indexes.includes(index), `missing index ${index}`);
  }

  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
});

test("migration never drops data", () => {
  // A re-runnable migration must not contain destructive statements: applying
  // it to a live database has to preserve every row.
  assert.doesNotMatch(MIGRATION, /\bDROP\s+(TABLE|INDEX)\b/i);
  assert.doesNotMatch(MIGRATION, /\bTRUNCATE\b/i);
  assert.doesNotMatch(MIGRATION, /\bDELETE\s+FROM\b/i);
});

// --- device identity -------------------------------------------------------

test("a device is keyed by its key and cannot be duplicated", () => {
  const db = open();
  const device = insertDevice(db);
  assert.equal(
    db.prepare("SELECT id FROM devices").get().id,
    device.id,
  );

  assert.throws(() => insertDevice(db), /UNIQUE|PRIMARY KEY/);

  // Same public key under a different (bogus) id must be rejected too.
  assert.throws(
    () => insertDevice(db, { id: OTHER_HOST_ID }),
    /UNIQUE/,
  );
});

test("device fields are bounded and consistent", () => {
  const db = open();
  const cases = [
    ["id too short", { id: "abc" }],
    ["id 63 chars", { id: "d".repeat(63) }],
    ["id too long", { id: "d".repeat(65) }],
    ["id upper case", { id: HOST_ID.toUpperCase() }],
    ["id not hex", { id: "z".repeat(64) }],
    ["key 31 bytes", { public_key: Buffer.alloc(31) }],
    ["key 33 bytes", { public_key: Buffer.alloc(33) }],
    ["fingerprint 63 chars", { fingerprint: "a".repeat(63) }],
    ["label 65 chars", { label: "x".repeat(65) }],
    ["client version 33 chars", { client_version: "v".repeat(33) }],
    ["protocol version 0", { protocol_version: 0 }],
    ["updated before created", { updated_at: NOW - 1 }],
  ];
  for (const [name, overrides] of cases) {
    assert.throws(() => insertDevice(db, overrides), /CHECK|UNIQUE/, name);
  }
  // Every rejected insert left the table empty.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM devices").get().n, 0);
});

test("revocation timestamp cannot predate creation", () => {
  const db = open();
  insertDevice(db);
  assert.throws(
    () =>
      db
        .prepare("UPDATE devices SET revoked_at = ? WHERE id = ?")
        .run(NOW - 1, HOST_ID),
    /CHECK/,
  );
});

// --- signal codes ----------------------------------------------------------

test("signal code rows are bounded, formatted and idempotent", () => {
  const db = open();
  insertDevice(db);
  insertCode(db);

  const cases = [
    ["duplicate code", { auth_nonce: "nonce-0000000002" }],
    ["letter in code", { code: "12345678901a" }],
    ["space in code", { code: "1234 5678901" }],
    ["empty ciphertext", { ciphertext: Buffer.alloc(0) }],
    ["ciphertext too large", { ciphertext: Buffer.alloc(4097) }],
    ["nonce 11 bytes", { nonce: Buffer.alloc(11) }],
    ["revoke hash 31 bytes", { revoke_hash: Buffer.alloc(31) }],
    ["expiry equals creation", { expires_at: NOW }],
    ["expiry before creation", { expires_at: NOW - 1 }],
    ["consumed before creation", { consumed_at: NOW - 1 }],
  ];
  for (const [name, overrides] of cases) {
    assert.throws(() => insertCode(db, overrides), /CHECK|UNIQUE|PRIMARY KEY/, name);
  }

  // A retry of the same create request (same host, same auth nonce) is
  // rejected by the dedupe constraint: the handler then returns the existing
  // code instead of minting a second one.
  assert.throws(
    () => insertCode(db, { code: "999999999999" }),
    /UNIQUE/,
  );

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM signal_codes").get().n, 1);
});

test("consume is single use and refuses expired codes", () => {
  const db = open();
  insertDevice(db);
  insertCode(db);

  const consume = db.prepare(
    `UPDATE signal_codes
        SET consumed_at = ?
      WHERE code = ?
        AND consumed_at IS NULL
        AND expires_at > ?`,
  );

  const first = consume.run(NOW + 1, CODE, NOW + 1);
  assert.equal(Number(first.changes), 1, "first resolve must consume the code");
  assert.equal(
    db.prepare("SELECT consumed_at FROM signal_codes WHERE code = ?").get(CODE)
      .consumed_at,
    NOW + 1,
  );

  const second = consume.run(NOW + 2, CODE, NOW + 2);
  assert.equal(Number(second.changes), 0, "second resolve must find nothing");

  // An expired, never-consumed code cannot be consumed either.
  insertCode(db, {
    code: "555555555555",
    auth_nonce: "nonce-0000000005",
    created_at: NOW - 1000,
    expires_at: NOW - 400,
  });
  const expired = consume.run(NOW, "555555555555", NOW);
  assert.equal(Number(expired.changes), 0);
});

test("cleanup removes only dead rows and is bounded", () => {
  const db = open();
  insertDevice(db);

  // 5 expired, 2 consumed-but-unexpired, 2 live.
  for (let i = 0; i < 5; i += 1) {
    insertCode(db, {
      code: String(100000000000 + i),
      auth_nonce: `nonce-expired-${i}`,
      created_at: NOW - 1000,
      expires_at: NOW - 500,
    });
  }
  for (let i = 0; i < 2; i += 1) {
    insertCode(db, {
      code: String(200000000000 + i),
      auth_nonce: `nonce-consumed-${i}`,
      created_at: NOW - 1000,
      consumed_at: NOW - 10,
    });
  }
  for (let i = 0; i < 2; i += 1) {
    insertCode(db, {
      code: String(300000000000 + i),
      auth_nonce: `nonce-live-${i}`,
    });
  }

  const before = db.prepare("SELECT COUNT(*) AS n FROM signal_codes").get().n;
  assert.equal(before, 9);

  db.prepare(
    `DELETE FROM signal_codes
      WHERE rowid IN (
        SELECT rowid FROM signal_codes
         WHERE expires_at < ? OR consumed_at < ?
         LIMIT 500
      )`,
  ).run(NOW, NOW);

  const remaining = db.prepare("SELECT code FROM signal_codes ORDER BY code").all();
  assert.equal(remaining.length, 2);
  assert.ok(remaining.every((row) => row.code.startsWith("3")));

  // The LIMIT keeps a single pass bounded, so a backlog drains over passes.
  const db2 = open();
  insertDevice(db2);
  const insert = db2.prepare(
    `INSERT INTO signal_codes
       (code, ciphertext, nonce, host_id, auth_nonce, created_at, expires_at, revoke_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < 600; i += 1) {
    insert.run(
      String(100000000000 + i),
      Buffer.from("x"),
      NONCE,
      HOST_ID,
      `nonce-${i}`,
      NOW - 1000,
      NOW - 500,
      HASH,
    );
  }
  const sweep = db2.prepare(
    `DELETE FROM signal_codes
      WHERE rowid IN (
        SELECT rowid FROM signal_codes WHERE expires_at < ? LIMIT 500
      )`,
  );
  assert.equal(Number(sweep.run(NOW).changes), 500);
  assert.equal(
    db2.prepare("SELECT COUNT(*) AS n FROM signal_codes").get().n,
    100,
  );
  assert.equal(Number(sweep.run(NOW).changes), 100);
  assert.equal(
    db2.prepare("SELECT COUNT(*) AS n FROM signal_codes").get().n,
    0,
  );
});

test("nonce table is bounded and sweepable", () => {
  const db = open();
  const insert = db.prepare(
    "INSERT INTO auth_nonces (nonce, device_id, expires_at) VALUES (?, ?, ?)",
  );
  insert.run("n".repeat(16), HOST_ID, NOW + 600);
  assert.throws(() => insert.run("n".repeat(16), HOST_ID, NOW + 600), /UNIQUE|PRIMARY KEY/);
  assert.throws(() => insert.run("short", HOST_ID, NOW + 600), /CHECK/);

  insert.run("m".repeat(16), HOST_ID, NOW - 1);
  db.prepare("DELETE FROM auth_nonces WHERE expires_at < ?").run(NOW);
  const left = db.prepare("SELECT nonce FROM auth_nonces").all();
  assert.equal(left.length, 1);
  assert.equal(left[0].nonce, "n".repeat(16));
});

// --- structural guarantees -------------------------------------------------

test("no table can hold screen, input or media data", () => {
  const db = open();
  const banned = /(frame|pixel|image|bitmap|screen|video|audio|clipboard|input|keylog)/i;
  for (const table of tableNames(db)) {
    for (const column of db.prepare(`PRAGMA table_info(${table})`).all()) {
      assert.doesNotMatch(
        column.name,
        banned,
        `${table}.${column.name} looks like media data`,
      );
    }
  }
  assert.doesNotMatch(tableNames(db).join(","), banned);
});

test("the host lookup query uses its index", () => {
  const db = open();
  const plan = db
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT code FROM signal_codes
        WHERE host_id = ?
        ORDER BY created_at DESC`,
    )
    .all(HOST_ID);
  const details = plan.map((row) => row.detail).join(" ");
  assert.match(details, /signal_codes_host_idx/);
});

test("audit events carry no payload beyond bounded text", () => {
  const db = open();
  db.prepare(
    "INSERT INTO audit_events (at, kind, device_id, detail) VALUES (?, ?, ?, ?)",
  ).run(NOW, "device_registered", HOST_ID, "ok");
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO audit_events (at, kind, detail) VALUES (?, ?, ?)")
        .run(NOW, "x".repeat(33), null),
    /CHECK/,
  );
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO audit_events (at, kind, detail) VALUES (?, ?, ?)")
        .run(NOW, "ok", "y".repeat(129)),
    /CHECK/,
  );
});
