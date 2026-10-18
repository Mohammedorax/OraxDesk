import { authenticate, consumeNonce, verifySignature } from "./auth";
import {
  MAX_CLIENT_VERSION_CHARS,
  MAX_LABEL_CHARS,
} from "./constants";
import { b64urlDecode } from "./crypto";
import { nowSeconds, sha256Hex } from "./encoding";
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
  protocol_version: number;
  client_version: string | null;
  created_at: number;
  revoked_at: number | null;
}

function deviceView(row: DeviceRow): Record<string, unknown> {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    protocol_version: row.protocol_version,
    client_version: row.client_version,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  };
}

const VIEW_COLUMNS = "id, fingerprint, protocol_version, client_version, created_at, revoked_at";

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
  rejectUnknownKeys(body, ["public_key", "label", "client_version", "protocol_version"]);
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
  const label = optionalString(body.label, "label", MAX_LABEL_CHARS);
  const clientVersion = optionalString(
    body.client_version,
    "client_version",
    MAX_CLIENT_VERSION_CHARS,
  );
  const protocolVersion = optionalInt(body.protocol_version, "protocol_version", 1, 255) ?? 1;

  const bodyHash = await sha256Hex(raw.bytes);
  const auth = await verifySignature(publicKey, request, bodyHash);
  await consumeNonce(env, auth.nonce, id);

  const now = nowSeconds();
  const existing = await env.DB.prepare(
    `SELECT ${VIEW_COLUMNS} FROM devices WHERE id = ?`,
  )
    .bind(id)
    .first<DeviceRow>();
  if (existing !== null) {
    if (existing.revoked_at !== null) {
      throw new ApiError(403, "forbidden", "This device was revoked");
    }
    await env.DB.prepare(
      "UPDATE devices SET label = ?, client_version = ?, protocol_version = ?, updated_at = ? WHERE id = ?",
    )
      .bind(label, clientVersion, protocolVersion, now, id)
      .run();
    return jsonResponse(
      deviceView({
        ...existing,
        protocol_version: protocolVersion,
        client_version: clientVersion,
      }),
      200,
    );
  }

  const fingerprint = await sha256Hex(publicKey);
  await env.DB.prepare(
    `INSERT INTO devices
       (id, public_key, fingerprint, label, client_version, protocol_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, publicKey, fingerprint, label, clientVersion, protocolVersion, now, now)
    .run();
  return jsonResponse(
    deviceView({
      id,
      fingerprint,
      protocol_version: protocolVersion,
      client_version: clientVersion,
      created_at: now,
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
  return emptyResponse(204);
}
