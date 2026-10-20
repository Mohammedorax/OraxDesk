-- The key a device signs its registry calls with.
--
-- It is NOT the peer-to-peer identity. The identity is the device's name in
-- the peer-to-peer world and is trusted by every machine that ever paired
-- with this one, so a leak of it is a leak of all of them. The registry key
-- signs HTTP requests and nothing else, and it is what a leaked identity
-- must NOT give away.
--
-- A device that has not been updated sends no registry key, and the Worker
-- falls back to the identity, so the separation is adopted one device at a
-- time rather than in one deployment.
ALTER TABLE devices ADD COLUMN registry_key BLOB
  CHECK (registry_key IS NULL OR length(registry_key) = 32);

-- The index is on the key the signature is checked against, which is the
-- registry key when there is one.
CREATE INDEX IF NOT EXISTS devices_registry_key_idx
  ON devices(registry_key) WHERE registry_key IS NOT NULL;
