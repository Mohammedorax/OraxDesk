import { authenticate, consumeNonce, verifySignature } from "./auth";
import { audit } from "./audit";
import {
  MAX_CLIENT_VERSION_CHARS,
  MAX_LABEL_CHARS,
} from "./constants";
import { b64urlDecode, deviceNumber } from "./crypto";
import { blobBytes, nowSeconds, sha256Hex } from "./encoding";
import type { Env } from "./env";
import {
  ApiError,
  emptyResponse,
  jsonResponse,
  optionalInt,
  optionalString,
  rejectUnknownKeys,
  requiredString,
  type RawBody,
} from "./http";
import { endpointId, isEndpointId } from "./id";

export interface DeviceRow {
  id: string;
  fingerprint: string;
  number: string | null;
  protocol_version: number;
  client_version: string | null;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

function deviceView(row: DeviceRow): Record<string, unknown> {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    number: row.number,
    protocol_version: row.protocol_version,
    client_version: row.client_version,
    created_at: row.created_at,
    // When the device was last here. It is the only liveness signal the
    // registry has, and it is written on every authenticated call rather
    // than by a heartbeat, so a device that never calls the registry is
    // never written about.
    last_seen_at: row.last_seen_at,
    revoked_at: row.revoked_at,
  };
}

const VIEW_COLUMNS =
  "id, fingerprint, number, protocol_version, client_version, created_at, last_seen_at, revoked_at";

/**
 * Registers a device, or refreshes an existing registration. The request is
 * signed by the key being registered, so possession is proven before any row
 * is written; the id is derived from the key, never supplied by the client.
 */
export async function registerDevice(
  env: Env,
  request: Request,
  body: Record<string, unknown>,
  raw: RawBody,
): Promise<Response> {
  rejectUnknownKeys(body, [
    "public_key",
    "registry_key",
    "label",
    "client_version",
    "protocol_version",
  ]);
  const publicKeyRaw = requiredString(body.public_key, "public_key", 64);
  let publicKey: Uint8Array;
  try {
    publicKey = b64urlDecode(publicKeyRaw);
  } catch {
    throw new ApiError(400, "bad_request", "public_key is not valid base64url");
  }
  const id = endpointId(publicKey);
  if ((request.headers.get("x-orax-device") ?? "") !== id) {
    throw new ApiError(409, "conflict", "X-Orax-Device does not match the public key");
  }

  // The registry key, when the device offers one.
  //
  // It is what the signature is checked against, and it is a different key
  // from the identity above: the identity is what every machine that ever
  // paired with this one trusts, so a device that signed its API calls with
  // it would hand a leaked identity to whoever could then take the wheel
  // everywhere.
  //
  // A device that sends none keeps working: the Worker falls back to the
  // identity, so the separation is adopted one device at a time.
  let registryKey: Uint8Array | null = null;
  if (body.registry_key !== undefined && body.registry_key !== null) {
    const raw_registry = requiredString(body.registry_key, "registry_key", 64);
    try {
      registryKey = b64urlDecode(raw_registry);
    } catch {
      throw new ApiError(400, "bad_request", "registry_key is not valid base64url");
    }
    if (registryKey.length !== 32) {
      throw new ApiError(400, "bad_request", "registry_key must be 32 bytes");
    }
    // The registry key must not BE the identity: that is the whole point of
    // having two.
    if (registryKey.length === publicKey.length && registryKey.every((b, i) => b === publicKey[i])) {
      throw new ApiError(400, "bad_request", "registry_key must not be the device's own identity key");
    }
  }

  const label = optionalString(body.label, "label", MAX_LABEL_CHARS);
  const clientVersion = optionalString(
    body.client_version,
    "client_version",
    MAX_CLIENT_VERSION_CHARS,
  );
  const protocolVersion = optionalInt(body.protocol_version, "protocol_version", 1, 255) ?? 1;

  const bodyHash = await sha256Hex(raw.bytes);
  // The registration is signed with the IDENTITY, which the Worker can
  // already derive from the submitted public key, and it OFFERS a registry
  // key in the same body.
  //
  // Signing it with the registry key would be a chicken and an egg: the
  // Worker only learns that key from this very request, so it would have
  // nothing to check the signature against. What the signature proves here is
  // that the caller holds the identity, which is what makes the offered
  // registry key trustworthy: it can only be the key the holder of the
  // identity chose.
  //
  // THAT IS TRUE ONLY FOR THE FIRST REGISTRATION. A device that already has
  // a registry key is held to it, and its refresh is checked against the
  // registry key rather than the identity.
  //
  // The reason is the blast radius the separation exists to bound. If a
  // refresh could be signed with the identity and could replace the stored
  // registry key, then a leak of the IDENTITY would be a leak of the
  // registry account as well: the holder of the identity could re-register
  // with a registry key of their own, sign every later call with it, mint
  // codes, publish an address and revoke the device, and the legitimate
  // owner would be locked out of their own account. The whole point of the
  // second key is that the identity must not be enough.
  const now = nowSeconds();
  const number = await deviceNumber(publicKey);
  const existing = await env.DB.prepare(
    `SELECT ${VIEW_COLUMNS}, registry_key FROM devices WHERE id = ?`,
  )
    .bind(id)
    .first<DeviceRow & { registry_key: ArrayBuffer | null }>();
  if (existing !== null && existing.revoked_at !== null) {
    throw new ApiError(403, "forbidden", "This device was revoked");
  }

  const storedRegistryKey =
    existing === null || existing.registry_key === null
      ? null
      : blobBytes(existing.registry_key);
  // A device that already has a registry key is held to it, and cannot
  // replace it by offering a different one. Rotation is a server-side act:
  // the row's column is cleared, and the device re-registers with the new
  // key, which the first branch below then accepts.
  if (storedRegistryKey !== null && registryKey !== null) {
    const same =
      storedRegistryKey.length === registryKey.length &&
      storedRegistryKey.every((b, i) => b === registryKey![i]);
    if (!same) {
      throw new ApiError(
        400,
        "bad_request",
        "the registry key does not match the one this device registered with",
      );
    }
  }

  // The key the signature is checked against: the stored registry key when
  // the device has one, and the identity when it does not.
  const signingKey = storedRegistryKey ?? publicKey;
  const { auth } = await verifySignature(signingKey, request, bodyHash);
  await consumeNonce(env, auth.nonce, id);

  if (existing !== null) {
    // Older rows registered before 0003 get their number backfilled here.
    //
    // The registry key is written ONLY when the column is empty. A device
    // that already has one keeps it, whatever this request offers.
    await env.DB.prepare(
      "UPDATE devices SET label = ?, client_version = ?, protocol_version = ?, number = COALESCE(number, ?), updated_at = ?, last_seen_at = ?, registry_key = CASE WHEN registry_key IS NULL THEN ? ELSE registry_key END WHERE id = ?",
    )
      .bind(
        label,
        clientVersion,
        protocolVersion,
        number,
        now,
        now,
        registryKey,
        id,
      )
      .run();
    await audit(env, "device.refreshed", id);
    return jsonResponse(
      deviceView({
        ...existing,
        number: existing.number ?? number,
        protocol_version: protocolVersion,
        client_version: clientVersion,
      }),
      200,
    );
  }

  const fingerprint = await sha256Hex(publicKey);
  await env.DB.prepare(
    `INSERT INTO devices
       (id, public_key, fingerprint, number, label, client_version, protocol_version, created_at, updated_at, last_seen_at, registry_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      publicKey,
      fingerprint,
      number,
      label,
      clientVersion,
      protocolVersion,
      now,
      now,
      now,
      registryKey,
    )
    .run();
  await audit(env, "device.registered", id);
  return jsonResponse(
    deviceView({
      id,
      fingerprint,
      number,
      protocol_version: protocolVersion,
      client_version: clientVersion,
      created_at: now,
      last_seen_at: now,
      revoked_at: null,
    }),
    201,
  );
}

/** Public record. It deliberately carries no address, label or secret. */
export async function getDevice(env: Env, id: string): Promise<Response> {
  if (!isEndpointId(id)) throw new ApiError(400, "bad_request", "Invalid device id");
  const row = await env.DB.prepare(
    `SELECT ${VIEW_COLUMNS} FROM devices WHERE id = ?`,
  )
    .bind(id)
    .first<DeviceRow>();
  if (row === null) throw new ApiError(404, "not_found", "No such device");
  return jsonResponse(deviceView(row));
}

/**
 * Lookup by the nine-digit number printed on the device. This is what lets a
 * helper type a number a person reads to them instead of a 64-character id.
 */
export async function getDeviceByNumber(env: Env, number: string): Promise<Response> {
  if (!/^\d{9}$/.test(number)) {
    throw new ApiError(400, "bad_request", "A device number is 9 digits");
  }
  const row = await env.DB.prepare(
    `SELECT ${VIEW_COLUMNS} FROM devices WHERE number = ?`,
  )
    .bind(number)
    .first<DeviceRow>();
  if (row === null) throw new ApiError(404, "not_found", "No such device");
  return jsonResponse(deviceView(row));
}

/**
 * Revokes a device. Only the device itself can do it, because the request is
 * signed with its key; there is no path where knowing an id is enough.
 */
export async function revokeDevice(
  env: Env,
  request: Request,
  id: string,
  bodyHash: string,
): Promise<Response> {
  if (!isEndpointId(id)) throw new ApiError(400, "bad_request", "Invalid device id");
  const auth = await authenticate(env, request, bodyHash);
  if (auth.id !== id) {
    throw new ApiError(403, "forbidden", "A device can only revoke itself");
  }
  const now = nowSeconds();
  await env.DB.prepare(
    "UPDATE devices SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL",
  )
  .bind(now, now, id)
  .run();
  // Pending codes for a revoked device must not outlive the revocation.
  await env.DB.prepare("DELETE FROM signal_codes WHERE host_id = ?").bind(id).run();
  await audit(env, "device.revoked", id);
  return emptyResponse(204);
}

