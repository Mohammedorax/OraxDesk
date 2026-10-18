-- A stable, human-readable number per device.
--
-- Derived from the device's public key and stored once, so it can be quoted on
-- the phone or read off the screen. Unique, so a number identifies exactly one
-- device. Not a secret: connecting still requires a code and the person's
-- approval.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS; `wrangler d1 migrations` applies this
-- once.

ALTER TABLE devices ADD COLUMN number TEXT
  CHECK (number IS NULL OR (length(number) = 9 AND number NOT GLOB '*[^0-9]*'));

CREATE UNIQUE INDEX IF NOT EXISTS devices_number_idx
  ON devices(number) WHERE number IS NOT NULL;
