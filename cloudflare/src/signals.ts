import { authenticate } from "./auth";
import { audit } from "./audit";
import {
  CODE_DIGITS,
  CODE_TTL_DEFAULT,
  CODE_TTL_MAX,
  CODE_TTL_MIN,
  INVITATION_MAX_FUTURE,
  MAX_CIPHERTEXT_BYTES,
  MAX_CODES_PER_HOUR,
  MAX_INVITATION_CHARS,
  REVOKE_TOKEN_BYTES,
} from "./constants";
import { b64urlDecode, currentInvitationKeyId, openInvitation, sealInvitation, selectInvitationKey } from "./crypto";
import {
  hexDecode,
  hexEncode,
  nowSeconds,
  randomBytes,
  randomDigits,
  sha256,
} from "./encoding";
import type { Env } from "./env";
import {
  ApiError,
  emptyResponse,
  jsonResponse,
  optionalInt,
  rejectUnknownKeys,
  requiredString,
} from "./http";

const NOT_FOUND = "This code is not valid, has expired, or was already used";

function normalizeCode(value: string): string {
  const digits = value.replaceAll(" ", "");
  if (!/^\d{12}$/.test(digits)) {
    throw new ApiError(400, "bad_request", "code must be 12 digits");
  }
  return digits;
}

/**
 * The Worker validates the envelope it is asked to store, but never rewrites
 * it: the invitation is produced and consumed by clients, and the API must not
 * change the protocol. Only what is needed to bound the row and the TTL is read.
 */
export function validateInvitation(invitation: string, now: number): void {
  if (!invitation.startsWith("boundary1:")) {
    throw new ApiError(400, "bad_request", "invitation must start with boundary1:");
  }
  if (invitation.length > MAX_INVITATION_CHARS) {
    throw new ApiError(400, "bad_request", "invitation is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(b64urlDecode(invitation.slice("boundary1:".length))),
    );
  } catch {
    throw new ApiError(400, "bad_request", "invitation is not valid");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ApiError(400, "bad_request", "invitation is not valid");
  }
  const value = parsed as Record<string, unknown>;
  if (value.version !== 1) {
    throw new ApiError(400, "bad_request", "unsupported invitation version");
  }
  if (!Array.isArray(value.secret) || value.secret.length !== 32) {
    throw new ApiError(400, "bad_request", "invitation is not valid");
  }
  if (typeof value.address !== "object" || value.address === null) {
    throw new ApiError(400, "bad_request", "invitation is not valid");
  }
  if (typeof value.expires !== "number" || !Number.isInteger(value.expires)) {
    throw new ApiError(400, "bad_request", "invitation is not valid");
  }
  if (value.expires <= now) {
    throw new ApiError(400, "bad_request", "invitation has already expired");
  }
  if (value.expires > now + INVITATION_MAX_FUTURE) {
    throw new ApiError(400, "bad_request", "invitation expiry is too far in the future");
  }
}

export async function createSignal(
  env: Env,
  request: Request,
  body: Record<string, unknown>,
  bodyHash: string,
): Promise<Response> {
  rejectUnknownKeys(body, ["invitation", "ttl_seconds"]);
  // The auth nonce is the idempotency key here, so it is not consumed: a
  // retried create returns the existing code (UNIQUE host_id, auth_nonce).
  const auth = await authenticate(env, request, bodyHash, { consumeNonce: false });
  const invitation = requiredString(body.invitation, "invitation", MAX_INVITATION_CHARS);
  const ttl =
    optionalInt(body.ttl_seconds, "ttl_seconds", CODE_TTL_MIN, CODE_TTL_MAX) ?? CODE_TTL_DEFAULT;
  const now = nowSeconds();
  validateInvitation(invitation, now);

  // A retry after a lost response returns the same code instead of a second one.
  const existing = await env.DB.prepare(
    "SELECT code, expires_at FROM signal_codes WHERE host_id = ? AND auth_nonce = ?",
  )
    .bind(auth.id, auth.nonce)
    .first<{ code: string; expires_at: number }>();
  if (existing !== null) {
    return jsonResponse({ code: existing.code, expires_at: existing.expires_at }, 200);
  }

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM signal_codes WHERE host_id = ? AND created_at > ?",
  )
    .bind(auth.id, now - 3600)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_CODES_PER_HOUR) {
    throw new ApiError(429, "rate_limited", "Too many codes for this device", {
      "retry-after": "600",
    });
  }

  const expiresAt = Math.min(now + ttl, now + CODE_TTL_MAX);
  const revokeToken = randomBytes(REVOKE_TOKEN_BYTES);
  const revokeHash = await sha256(revokeToken);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomDigits(CODE_DIGITS);
    const aad = `${code}:${expiresAt}`;
    const keyId = currentInvitationKeyId(env);
    const { ciphertext, nonce } = await sealInvitation(env.INVITATION_KEY, invitation, aad);
    if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
      throw new ApiError(400, "bad_request", "invitation is too large");
    }
    try {
      await env.DB.prepare(
        `INSERT INTO signal_codes
           (code, ciphertext, nonce, host_id, auth_nonce, created_at, expires_at, revoke_hash, key_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(code, ciphertext, nonce, auth.id, auth.nonce, now, expiresAt, revokeHash, keyId)
        .run();
      await audit(env, "signal.created", auth.id);
      return jsonResponse(
        { code, expires_at: expiresAt, revoke_token: hexEncode(revokeToken) },
        201,
      );
    } catch (error) {
      // Only a code collision is retried; anything else is a real failure.
      if (String((error as Error).message).includes("signal_codes.code")) continue;
      throw error;
    }
  }
  throw new ApiError(503, "unavailable", "Could not allocate a code, try again", {
    "retry-after": "2",
  });
}

export async function resolveSignal(
  env: Env,
  body: Record<string, unknown>,
): Promise<Response> {
  rejectUnknownKeys(body, ["code"]);
  const code = normalizeCode(requiredString(body.code, "code", 32));
  const now = nowSeconds();
  // The row is READ FIRST and the guarded UPDATE comes after it.
  //
  // The other order looks safer and is not: consume, then read. Between the
  // two statements a revoke, a device revocation or the sweeper can delete
  // the row, and the code has then been consumed and the helper gets a 404.
  // The session is lost and the code is gone, and neither side can tell what
  // happened.
  //
  // Reading first means the code is not CONSUMED on the way to finding out
  // that it was already gone. It does not mean the resolve succeeds: if the
  // row was deleted before this read, there is nothing to read and the
  // helper gets a 404 like any other unknown code. What it buys is that a
  // code deleted between the read and the UPDATE is not marked consumed on
  // the way out, and a code deleted before the read never was.
  const row = await env.DB.prepare(
    "SELECT ciphertext, nonce, expires_at, key_id, host_id FROM signal_codes WHERE code = ?",
  )
    .bind(code)
    .first<{
      ciphertext: ArrayBuffer;
      nonce: ArrayBuffer;
      expires_at: number;
      key_id: string;
      host_id: string;
    }>();
  if (row === null) throw new ApiError(404, "not_found", NOT_FOUND);
  if (row.expires_at <= now) throw new ApiError(404, "not_found", NOT_FOUND);

  // Exactly one caller wins this. The statement is atomic on its own, so
  // two resolves of the same code cannot both see a change of one.
  const claimed = await env.DB.prepare(
    "UPDATE signal_codes SET consumed_at = ? WHERE code = ? AND consumed_at IS NULL AND expires_at > ?",
  )
    .bind(now, code, now)
    .run();
  if (claimed.meta.changes !== 1) throw new ApiError(404, "not_found", NOT_FOUND);

  const openingKey = selectInvitationKey(
    {
      current: env.INVITATION_KEY,
      currentId: currentInvitationKeyId(env),
      previous: env.INVITATION_KEY_PREVIOUS,
      previousId: env.INVITATION_KEY_ID_PREVIOUS,
    },
    row.key_id,
  );
  if (openingKey === null) throw new ApiError(404, "not_found", NOT_FOUND);
  let invitation: string;
  try {
    invitation = await openInvitation(
      openingKey,
      new Uint8Array(row.ciphertext),
      new Uint8Array(row.nonce),
      `${code}:${row.expires_at}`,
    );
  } catch {
    // Tampered or sealed under another key: fail closed, never 500.
    throw new ApiError(404, "not_found", NOT_FOUND);
  }
  await audit(env, "signal.resolved", row.host_id);
  return jsonResponse({ invitation });
}

export async function revokeSignal(
  env: Env,
  body: Record<string, unknown>,
): Promise<Response> {
  rejectUnknownKeys(body, ["revoke_token"]);
  const tokenRaw = requiredString(body.revoke_token, "revoke_token", 64);
  let token: Uint8Array;
  try {
    token = hexDecode(tokenRaw);
  } catch {
    throw new ApiError(400, "bad_request", "revoke_token must be 64 hex characters");
  }
  if (token.length !== REVOKE_TOKEN_BYTES) {
    throw new ApiError(400, "bad_request", "revoke_token must be 64 hex characters");
  }
  const hash = await sha256(token);
  const removed = await env.DB.prepare(
    "DELETE FROM signal_codes WHERE revoke_hash = ?",
  )
    .bind(hash)
    .run();
  if (removed.meta.changes > 0) {
    // Which host the withdrawn code belonged to is not in the row any more, so
    // the trail names the revocation without a device. The code itself is not
    // written down: it is a capability, and this table outlives it.
    await audit(env, "signal.revoked", null, "code withdrawn");
  }
  return emptyResponse(204);
}
