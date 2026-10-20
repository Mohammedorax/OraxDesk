import { AES_KEY_BYTES } from "./constants";
import { b64urlDecode, b64urlEncode, sha256, utf8 } from "./encoding";

const keyCache = new Map<string, Promise<CryptoKey>>();

function decodeKey(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.length !== AES_KEY_BYTES) {
    throw new Error(`INVITATION_KEY must be ${AES_KEY_BYTES} bytes`);
  }
  return bytes;
}

function invitationKey(base64Key: string): Promise<CryptoKey> {
  const cached = keyCache.get(base64Key);
  if (cached !== undefined) return cached;
  const imported = crypto.subtle.importKey(
    "raw",
    decodeKey(base64Key),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  keyCache.set(base64Key, imported);
  return imported;
}

/**
 * Whether the Worker can seal invitations, without revealing the key. Reported
 * by /healthz so an operator sees a missing secret immediately instead of
 * guessing from a 503 on the first real request.
 */
export function invitationKeyStatus(base64Key: string | undefined): "ok" | "missing" | "invalid" {
  if (base64Key === undefined || base64Key.length === 0) return "missing";
  try {
    decodeKey(base64Key);
    return "ok";
  } catch {
    return "invalid";
  }
}

export interface SealedInvitation {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * Seals the invitation under a Worker secret. `aad` binds the ciphertext to the
 * code and its expiry, so a row cannot be swapped for another one.
 */
export async function sealInvitation(
  base64Key: string,
  plaintext: string,
  aad: string,
): Promise<SealedInvitation> {
  const key = await invitationKey(base64Key);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: utf8(aad) },
      key,
      utf8(plaintext),
    ),
  );
  return { ciphertext, nonce };
}

/** Fails closed: any tampering, wrong key or wrong AAD throws. */
export async function openInvitation(
  base64Key: string,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad: string,
): Promise<string> {
  const key = await invitationKey(base64Key);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: utf8(aad) },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Which key sealed a row. The current key is the default; a row sealed under
 * the previous key is still readable during a rotation window. Unknown key ids
 * return null and the caller fails closed.
 */
export function selectInvitationKey(
  keys: {
    current: string;
    currentId?: string;
    previous?: string;
    previousId?: string;
  },
  keyId: string,
): string | null {
  if (keyId === (keys.currentId ?? "k1")) return keys.current;
  if (keys.previous !== undefined && keyId === (keys.previousId ?? "k1")) {
    return keys.previous;
  }
  return null;
}

/** The key id to record on new rows. Changing it starts a rotation window. */
export function currentInvitationKeyId(env: { INVITATION_KEY_ID?: string }): string {
  return (env.INVITATION_KEY_ID ?? "k1").slice(0, 8);
}

/**
 * A stable nine-digit number for a device, derived from its public key.
 *
 * The same key always yields the same number, so it survives restarts and
 * re-registration without needing a lookup.
 *
 * Uniqueness is enforced by the registry's unique index, and a collision
 * fails loudly there rather than merging two devices. The space is a billion
 * values, so the birthday bound says a collision becomes likely somewhere
 * around thirty thousand registered devices, not the millions the first
 * version of this comment claimed: with a billion values, a fifty percent
 * chance of any collision at all arrives at about sqrt(1e9) devices. That is
 * far beyond a personal deployment, but it is the number that matters if the
 * registry ever grows into a service, and the number to widen when it does.
 */
export async function deviceNumber(publicKey: Uint8Array): Promise<string> {
  const digest = await sha256(publicKey);
  const value =
    ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return String(value % 1_000_000_000).padStart(9, "0");
}

export async function verifyEd25519(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, [
    "verify",
  ]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, signature, message);
}

export { b64urlDecode, b64urlEncode };
