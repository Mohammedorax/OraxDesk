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
  // The number is DERIVED from the key, so two devices can derive the same
  // one, and the space is a billion, so that is rare and it gets rarer as
  // the registry grows.
  //
  // It still has to be handled, because the failure mode is not "one device
  // has a different number". It is that the UNIQUE index refuses the
  // insert, the refusal comes back as a 500, and the device can NEVER
  // register: the number is derived from its identity, so retrying changes
  // nothing. A computer that cannot register is a computer nobody can help.
  //
  // So the number is DISAMBIGUATED: the next free number in a small window
  // is taken, and the client is told which one it got, because the number
  // is what a person reads out loud and it has to be the one the registry
  // has. The client shows the registry's number for exactly this reason.
  const assigned = await insertWithFreeNumber(env, {
    id,
    publicKey,
    fingerprint,
    base: number,
    label,
    clientVersion,
    protocolVersion,
    now,
    registryKey,
  });
  await audit(env, "device.registered", id);
  return jsonResponse(
    deviceView({
      id,
      fingerprint,
      number: assigned,
      protocol_version: protocolVersion,
      client_version: clientVersion,
      created_at: now,
      last_seen_at: now,
      revoked_at: null,
    }),
    201,
  );
}

/**
 * Insert the device, taking the next free number if the derived one is
 * taken.
 *
 * The check and the insert are not one statement, so two devices can pick
 * the same disambiguated number at the same moment. The UNIQUE constraint is
 * the real guard, and a loser of that race tries again with the next
 * candidate. The number of attempts is bounded, and the last failure is a
 * CONFLICT with a code the client can tell from a server fault: a 500 says
 * "something broke", and a 409 says "this computer's number is taken", and
 * only one of those is true.
 */
async function insertWithFreeNumber(
  env: Env,
  row: {
    id: string;
    publicKey: Uint8Array;
    fingerprint: string;
    base: string;
    label: string | null;
    clientVersion: string | null;
    protocolVersion: number;
    now: number;
    registryKey: Uint8Array | null;
  },
): Promise<string> {
  const start = Number(row.base);
  // The window is small on purpose: the numbers are read out loud, so a
  // number far from the derived one is a number a person will read wrong.
  const WINDOW = 100;
  for (let round = 0; round < 5; round += 1) {
    for (let offset = 0; offset < WINDOW; offset += 1) {
      const candidate = String((start + offset) % 1_000_000_000).padStart(9, "0");
      const taken = await env.DB.prepare(
        "SELECT id FROM devices WHERE number = ? LIMIT 1",
      )
        .bind(candidate)
        .first<{ id: string }>();
      if (taken !== null) continue;
      try {
        await env.DB.prepare(
          `INSERT INTO devices
             (id, public_key, fingerprint, number, label, client_version, protocol_version, created_at, updated_at, last_seen_at, registry_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            row.id,
            row.publicKey,
            row.fingerprint,
            candidate,
            row.label,
            row.clientVersion,
            row.protocolVersion,
            row.now,
            row.now,
            row.now,
            row.registryKey,
          )
          .run();
        return candidate;
      } catch (error) {
        // Someone took it between the check and the insert. Try the next one.
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }
  throw new ApiError(
    409,
    "conflict",
    "this computer's number is taken; contact the registry administrator",
  );
}

/** Whether a D1 error is a UNIQUE constraint being refused. */
function isUniqueViolation(error: unknown): boolean {
  return String((error as Error)?.message ?? error).includes("UNIQUE");
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
  // The row is the tombstone: cleanup keeps revoked rows forever, so a
  // revoked machine cannot re-register.
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

/**
 * Constant-time string comparison, used for the operator key.
 *
 * `a === b` returns as soon as two bytes differ, so the time it takes leaks
 * how much of the guess was right. This walks both strings to the longer
 * length and folds every difference into one accumulator, with the length
 * folded in too rather than short-circuited.
 */
function sameSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Operator revocation: turn a device off from the server side.
 *
 * A device can only revoke itself with its own key, and that is the wrong tool
 * when the machine is stolen or the key is believed compromised: the holder of
 * the key will not do it. This is the one server-side act, gated on a secret
 * that exists only in the deployment (`wrangler secret put OPERATOR_TOKEN`),
 * and it is deliberately a full stop rather than a "lock": the tombstone stays,
 * the device cannot re-register, and its pending codes are dropped. Lifting a
 * revocation is a database decision, not an API one.
 *
 * With no token configured the endpoint does not exist (404), so a deployment
 * that never intended to have an operator has no remote administration surface
 * at all.
 */
export async function revokeDeviceAsOperator(
  env: Env,
  request: Request,
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const operator = env.OPERATOR_TOKEN;
  if (operator === undefined || operator === "") {
    throw new ApiError(404, "not_found", "No such endpoint");
  }
  const supplied = request.headers.get("x-orax-operator") ?? "";
  if (!sameSecret(supplied, operator)) {
    // Missing and wrong answer the same thing: a different 401 for "no token"
    // would tell a prober whether this deployment has an operator at all.
    throw new ApiError(401, "unauthorized", "Invalid operator token");
  }
  if (!isEndpointId(id)) throw new ApiError(400, "bad_request", "Invalid device id");
  rejectUnknownKeys(body, ["reason"]);
  const reason = optionalString(body.reason, "reason", 120);

  const now = nowSeconds();
  const revoked = await env.DB.prepare(
    "UPDATE devices SET revoked_at = COALESCE(revoked_at, ?), registry_key = NULL, updated_at = ? WHERE id = ?",
  )
    .bind(now, now, id)
    .run();
  if (revoked.meta.changes === 0) {
    throw new ApiError(404, "not_found", "No such device");
  }
  await env.DB.prepare("DELETE FROM signal_codes WHERE host_id = ?").bind(id).run();
  await audit(env, "device.revoked", id, reason ?? "operator revocation");
  return emptyResponse(204);
}

