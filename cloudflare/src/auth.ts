import { AUTH_MAX_SKEW_SECONDS, NONCE_TTL_SECONDS } from "./constants";
import { verifyEd25519 } from "./crypto";
import { b64urlDecode, nowSeconds, utf8 } from "./encoding";
import type { Env } from "./env";
import { ApiError } from "./http";
import { isEndpointId } from "./id";

/**
 * Domain-separated canonical string. The device key already signs iroh
 * handshakes, so the API must sign a string that can never be mistaken for one
 * of those messages.
 */
export const AUTH_PREFIX = "orax-device-auth-v1";

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

export function canonicalString(
  method: string,
  path: string,
  bodySha256Hex: string,
  timestamp: number,
  nonce: string,
): string {
  return [
    AUTH_PREFIX,
    method.toUpperCase(),
    path,
    bodySha256Hex,
    String(timestamp),
    nonce,
  ].join("\n");
}

export async function verifySignature(
  publicKey: Uint8Array,
  request: Request,
  bodySha256Hex: string,
): Promise<AuthHeaders> {
  const auth = readAuthHeaders(request);
  const now = nowSeconds();
  if (Math.abs(now - auth.timestamp) > AUTH_MAX_SKEW_SECONDS) {
    throw unauthorized("Request timestamp is outside the allowed window");
  }
  const path = new URL(request.url).pathname;
  const message = utf8(
    canonicalString(request.method, path, bodySha256Hex, auth.timestamp, auth.nonce),
  );
  if (!(await verifyEd25519(publicKey, message, auth.signature))) {
    throw unauthorized("Signature does not verify");
  }
  return auth;
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
    "SELECT public_key, revoked_at FROM devices WHERE id = ?",
  )
    .bind(auth.id)
    .first<{ public_key: ArrayBuffer; revoked_at: number | null }>();
  if (row === null) throw unauthorized("This device is not registered");
  if (row.revoked_at !== null) {
    throw new ApiError(403, "forbidden", "This device was revoked");
  }
  const publicKey = new Uint8Array(row.public_key);
  await verifySignature(publicKey, request, bodySha256Hex);
  if (options.consumeNonce !== false) {
    await consumeNonce(env, auth.nonce, auth.id);
  }
  return { id: auth.id, publicKey, nonce: auth.nonce };
}
