-- Revoking a code deletes it by the hash of its revoke token, and that was the
-- one lookup in the table with no index: every revoke scanned every live code
-- (bounded by the TTL, but O(n) at a busy deployment's steady state). Additive
-- on purpose, like every migration here: an older Worker ignores it, and no
-- row is rewritten.
CREATE INDEX IF NOT EXISTS signal_codes_revoke_idx ON signal_codes(revoke_hash);
