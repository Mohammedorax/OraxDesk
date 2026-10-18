-- Key rotation support: each sealed invitation records which key sealed it, so
-- a new INVITATION_KEY can be deployed without losing codes created seconds
-- earlier. The previous key is provided for one rotation window as
-- INVITATION_KEY_PREVIOUS.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS; this migration is tracked by
-- `wrangler d1 migrations`, so it runs exactly once.

ALTER TABLE signal_codes ADD COLUMN key_id TEXT NOT NULL DEFAULT 'k1'
  CHECK (length(key_id) BETWEEN 1 AND 8);
