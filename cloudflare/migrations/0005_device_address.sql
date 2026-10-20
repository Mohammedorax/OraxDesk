-- The published address of a device.
--
-- This is ADDRESS DATA, not session data: where the device can be reached.
-- The same shape the `boundary1:` invitation already carries, so a helper
-- that has found a device here and a helper that has been given an
-- invitation are reaching the same machine the same way.
--
-- It is not a secret, and the reason is worth writing down: iroh's QUIC
-- handshake authenticates the peer by its key, so an address is a place to
-- knock, never a way in. Publishing it is what makes a machine reachable by
-- its id alone.
ALTER TABLE devices ADD COLUMN address TEXT;
ALTER TABLE devices ADD COLUMN address_at INTEGER;

-- The address of a device, looked up by its id. The index is on the id
-- because that is the only way the address is ever read.
CREATE INDEX IF NOT EXISTS devices_address_idx
  ON devices(address_at) WHERE address IS NOT NULL;
