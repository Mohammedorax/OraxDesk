import {
  AUTH_MAX_SKEW_SECONDS,
  LEGACY_AUTH_ACCEPT_UNTIL,
  NONCE_TTL_SECONDS,
} from "./constants";
import { verifyEd25519 } from "./crypto";
import { b64urlDecode, blobBytes, nowSeconds, utf8 } from "./encoding";
import type { Env } from "./env";
import { ApiError } from "./http";
import { isEndpointId } from "./id";

/**
 * Domain-separated canonical string. The device key already signs iroh
 * handshakes, so the API must sign a string that can never be mistaken for one
 * of those messages.
 *
 * The ORIGIN is part of what is signed. Without it, a signature captured at
 * one registry verifies at any other registry for the same method and path,
 * which means a device that was pointed at one registry could have its
 * request replayed at another, and an invitation meant for one registry could
 * be read by another.
 */
export const AUTH_PREFIX = "orax-device-auth-v2";

/**
 * The prefix of the previous version, accepted only during the rollout.
 *
 * See [`legacyCanonicalString`]: a v2 Worker cannot read a v1 signature, and
 * a v1 Worker cannot read a v2 one, so both are accepted for a bounded time
 * and every v1 acceptance is announced.
 */
export const LEGACY_AUTH_PREFIX = "orax-device-auth-v1";

export interface AuthHeaders {
  id: string;
  timestamp: number;
  nonce: string;
  signature: Uint8Array;
}

function unauthorized(message: string): ApiError {
  return new ApiError(401, "unauthorized", message);
}

export function readAuthHeaders(request: Request): AuthHeaders {
  const id = request.headers.get("x-orax-device") ?? "";
  const timestampRaw = request.headers.get("x-orax-timestamp") ?? "";
  const nonce = request.headers.get("x-orax-nonce") ?? "";
  const signatureRaw = request.headers.get("x-orax-signature") ?? "";

  if (!isEndpointId(id)) throw unauthorized("X-Orax-Device must be a 64 character hex endpoint id");
  if (!/^\d{1,12}$/.test(timestampRaw)) throw unauthorized("X-Orax-Timestamp is missing or invalid");
  if (!/^[A-Za-z0-9_-]{22}$/.test(nonce)) throw unauthorized("X-Orax-Nonce is missing or invalid");

  let signature: Uint8Array;
  try {
    signature = b64urlDecode(signatureRaw);
  } catch {
    throw unauthorized("X-Orax-Signature is not valid base64url");
  }
  if (signature.length !== 64) throw unauthorized("X-Orax-Signature must be 64 bytes");
  return { id, timestamp: Number(timestampRaw), nonce, signature };
}

/**
 * The origin a request came in on, as `scheme://host[:port]`.
 *
 * The default port is left out, and so it is on the client side, so the two
 * agree on what the origin is.
 */
export function requestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export function canonicalString(
  origin: string,
  method: string,
  path: string,
  bodySha256Hex: string,
  timestamp: number,
  nonce: string,
): string {
  return [
    AUTH_PREFIX,
    origin,
    method.toUpperCase(),
    path,
    bodySha256Hex,
    String(timestamp),
    nonce,
  ].join("\n");
}

/**
 * The v1 canonical string: the same fields, without the origin.
 *
 * It is not a fallback the protocol wants to keep. It is a migration window.
 * A v2 Worker cannot read a v1 client's signature, so a Worker that only
 * knows v2 refuses every client that has not been updated; a Worker that
 * only knows v1 accepts a signature that can be replayed at another
 * registry. Accepting both for a bounded time, and saying so every time a v1
 * signature is accepted, is the honest way across that: a window with no
 * signal is a window with no end.
 */
export function legacyCanonicalString(
  method: string,
  path: string,
  bodySha256Hex: string,
  timestamp: number,
  nonce: string,
): string {
  return [
    LEGACY_AUTH_PREFIX,
    method.toUpperCase(),
    path,
    bodySha256Hex,
    String(timestamp),
    nonce,
  ].join("\n");
}

/**
 * The canonical string, whichever version the client used.
 *
 * The version is RETURNED, because the caller has to know which one was
 * accepted: the window exists so an operator can watch the old clients drain.
 */
export async function verifySignature(
  publicKey: Uint8Array,
  request: Request,
  bodySha256Hex: string,
): Promise<{ auth: AuthHeaders; version: 1 | 2 }> {
  const auth = readAuthHeaders(request);
  const now = nowSeconds();
  if (Math.abs(now - auth.timestamp) > AUTH_MAX_SKEW_SECONDS) {
    throw unauthorized("Request timestamp is outside the allowed window");
  }
  const url = new URL(request.url);
  const v2 = utf8(
    canonicalString(
      requestOrigin(request),
      request.method,
      url.pathname,
      bodySha256Hex,
      auth.timestamp,
      auth.nonce,
    ),
  );
  if (await verifyEd25519(publicKey, v2, auth.signature)) {
    return { auth, version: 2 };
  }
  // The legacy form, so a client that has not been updated yet is not
  // locked out during the rollout. Every acceptance is announced, because the
  // window is only allowed to be open for as long as it takes to drain.
  //
  // And the window CLOSES. A v1 signature has no origin in it, so a
  // signature captured at one registry verifies at another, which is the
  // replay the v2 form exists to stop. Accepting it for ever would be
  // accepting that replay for ever, and an operator needs a way to end it.
  // The deadline is a number rather than a flag, so the window has an end
  // that is written down.
  if (nowSeconds() > LEGACY_AUTH_ACCEPT_UNTIL) {
    console.warn(
      "auth: a v1 signature was refused because the migration window has closed",
    );
    throw unauthorized("Signature does not verify");
  }
  const v1 = utf8(
    legacyCanonicalString(
      request.method,
      url.pathname,
      bodySha256Hex,
      auth.timestamp,
      auth.nonce,
    ),
  );
  if (await verifyEd25519(publicKey, v1, auth.signature)) {
    console.warn(
      "auth: a v1 signature was accepted; the migration window is still open",
    );
    return { auth, version: 1 };
  }
  throw unauthorized("Signature does not verify");
}

/** One use per nonce, so a captured request cannot be replayed. */
export async function consumeNonce(env: Env, nonce: string, deviceId: string): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO auth_nonces (nonce, device_id, expires_at) VALUES (?, ?, ?)",
    )
      .bind(nonce, deviceId, nowSeconds() + NONCE_TTL_SECONDS)
      .run();
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw unauthorized("This request nonce was already used");
    }
    throw error;
  }
}

export interface AuthenticatedDevice {
  id: string;
  publicKey: Uint8Array;
  nonce: string;
}

/**
 * Authenticates a request from a registered device. The signature is checked
 * against the key stored for that id, so knowing an id is never enough.
 *
 * `consumeNonce` is false only where the nonce doubles as an idempotency key
 * (creating a signal): replaying that request returns the same code rather
 * than a new one, so a retry after a lost response is safe and cannot grow
 * storage.
 */
export async function authenticate(
  env: Env,
  request: Request,
  bodySha256Hex: string,
  options: { consumeNonce?: boolean } = {},
): Promise<AuthenticatedDevice> {
  const auth = readAuthHeaders(request);
  const row = await env.DB.prepare(
    "SELECT public_key, registry_key, revoked_at FROM devices WHERE id = ?",
  )
    .bind(auth.id)
    .first<{
      public_key: ArrayBuffer;
      registry_key: ArrayBuffer | null;
      revoked_at: number | null;
    }>();
  if (row === null) throw unauthorized("This device is not registered");
  if (row.revoked_at !== null) {
    throw new ApiError(403, "forbidden", "This device was revoked");
  }
  // The signature is checked against the REGISTRY key when the device has
  // one, and against the identity when it does not. A device that offered a
  // registry key at registration is held to it, so a key that was rotated
  // away cannot be used for anything.
  const registryBytes =
    row.registry_key === null ? null : blobBytes(row.registry_key);
  const signingKey =
    registryBytes !== null && registryBytes.length === 32
      ? registryBytes
      : blobBytes(row.public_key);
  await verifySignature(signingKey, request, bodySha256Hex);
  if (options.consumeNonce !== false) {
    await consumeNonce(env, auth.nonce, auth.id);
  }
  // The device was here just now.
  //
  // This is not a heartbeat: it happens on a request the device chose to
  // make, so the cost is one row update per authenticated call, and a device
  // that never calls the registry is never written about. It is the only
  // liveness signal the registry has, and the column existed from the first
  // migration without ever being written.
  //
  // A failure to record it does not fail the request: the call itself is
  // what the device asked for, and liveness is a report about it rather than
  // a precondition for it.
  try {
    await env.DB.prepare(
      "UPDATE devices SET last_seen_at = ? WHERE id = ?",
    )
      .bind(nowSeconds(), auth.id)
      .run();
  } catch (error) {
    console.error(`audit: could not record last seen: ${(error as Error).name}`);
  }
  return { id: auth.id, publicKey: signingKey, nonce: auth.nonce };
}
