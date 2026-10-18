-- Orax Remote — device registry and signal codes.
--
-- Safe to re-run: every statement is idempotent. The authoritative migration
-- tracker is `wrangler d1 migrations`, but this file is also applied directly by
-- the offline schema tests in `cloudflare/test/`, so it must never assume a
-- particular tracker state.
--
-- Invariants this schema is responsible for:
--   * A device row is keyed by its ed25519 public key's EndpointId. No client
--     supplied identifier is ever stored, so a row cannot be claimed by knowing
--     a string.
--   * `signal_codes.ciphertext` is an AES-GCM sealed invitation. The plaintext
--     invitation (an address plus a 32-byte session secret) never reaches D1.
--   * A code is single-use. `consumed_at` is the guard and the only writer is
--     the guarded UPDATE in the resolve handler.
--   * No column anywhere holds screen, input, clipboard or audio data.

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  -- EndpointId is iroh's Display form of the ed25519 public key: 64 lower-case
  -- hex characters (iroh-base key.rs, Display -> HEXLOWER; FromStr also accepts
  -- z-base-32, but the canonical stored form is hex).
  id               TEXT    PRIMARY KEY CHECK (length(id) = 64 AND id NOT GLOB '*[^0-9a-f]*'),
  public_key       BLOB    NOT NULL CHECK (length(public_key) = 32),
  -- Lower-case hex SHA-256 of the public key, for display and comparison.
  fingerprint      TEXT    NOT NULL CHECK (length(fingerprint) = 64),
  label            TEXT    CHECK (label IS NULL OR length(label) <= 64),
  client_version   TEXT    CHECK (client_version IS NULL OR length(client_version) <= 32),
  protocol_version INTEGER NOT NULL DEFAULT 1 CHECK (protocol_version BETWEEN 1 AND 255),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  last_seen_at     INTEGER,
  revoked_at       INTEGER,
  replaced_by      TEXT    CHECK (replaced_by IS NULL OR (length(replaced_by) = 64 AND replaced_by NOT GLOB '*[^0-9a-f]*')),
  CHECK (updated_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

-- The primary key already implies uniqueness of the key; this index makes it
-- explicit and lets the register handler detect a key already present under a
-- different derived id instead of silently creating a second row.
CREATE UNIQUE INDEX IF NOT EXISTS devices_public_key_idx ON devices(public_key);
CREATE INDEX IF NOT EXISTS devices_revoked_idx ON devices(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS devices_last_seen_idx ON devices(last_seen_at) WHERE last_seen_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS signal_codes (
  -- 12 decimal digits, the only capability a helper types.
  code         TEXT    PRIMARY KEY,
  -- AES-256-GCM sealed `Invitation` JSON. 12-byte nonce per row; AAD binds
  -- code + expires_at so a row cannot be swapped for another.
  ciphertext   BLOB    NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 4096),
  nonce        BLOB    NOT NULL CHECK (length(nonce) = 12),
  host_id      TEXT    NOT NULL,
  -- The auth nonce of the create request, so a retry after a lost response
  -- returns the same code instead of minting a second one.
  auth_nonce   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at  INTEGER,
  -- SHA-256 of the 32-byte revoke token. The token itself is never stored.
  revoke_hash  BLOB    NOT NULL CHECK (length(revoke_hash) = 32),
  -- 12 decimal digits. Written as one negated character class rather than
  -- twelve [0-9] groups: workerd's SQLite rejects long character-class GLOB
  -- patterns with "LIKE or GLOB pattern too complex" while accepting this form,
  -- so this shape keeps the schema identical on D1 and on node:sqlite.
  CHECK (length(code) = 12 AND code NOT GLOB '*[^0-9]*'),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  UNIQUE (host_id, auth_nonce)
);

CREATE INDEX IF NOT EXISTS signal_codes_expiry_idx ON signal_codes(expires_at);
CREATE INDEX IF NOT EXISTS signal_codes_host_idx   ON signal_codes(host_id, created_at);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce      TEXT    PRIMARY KEY,
  device_id  TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (length(nonce) BETWEEN 16 AND 64)
);
CREATE INDEX IF NOT EXISTS auth_nonces_expiry_idx ON auth_nonces(expires_at);

-- Deliberately content-free: kind + subject + time. No address, no code, no
-- invitation, no screen data, no session content.
CREATE TABLE IF NOT EXISTS audit_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  kind      TEXT    NOT NULL CHECK (length(kind) BETWEEN 1 AND 32),
  device_id TEXT    CHECK (device_id IS NULL OR (length(device_id) = 64 AND device_id NOT GLOB '*[^0-9a-f]*')),
  detail    TEXT    CHECK (detail IS NULL OR length(detail) <= 128)
);
CREATE INDEX IF NOT EXISTS audit_events_at_idx ON audit_events(at);

INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('schema_version', '1');
