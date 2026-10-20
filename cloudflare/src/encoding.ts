const encoder = new TextEncoder();

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

const HEX = "0123456789abcdef";

export function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 0x0f);
  return out;
}

export function hexDecode(value: string): Uint8Array {
  if (value.length % 2 !== 0 || /[^0-9a-fA-F]/.test(value)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hexEncode(await sha256(bytes));
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * A BLOB column as bytes.
 *
 * D1 hands a BLOB back in whichever shape its driver produced: an
 * `ArrayBuffer` in one place, an array of byte values in another, and the two
 * do not agree on what `byteLength` is. Normalising here means the callers
 * never have to know, and a length check is a length check.
 */
export function blobBytes(value: ArrayBuffer | ArrayBufferView | number[]): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Random decimal digits, uniform enough for a short capability code. */
export function randomDigits(length: number): string {
  let code = "";
  while (code.length < length) {
    for (const byte of randomBytes(32)) {
      // Reject the incomplete tail of the 0..249 range so digits stay uniform.
      if (byte < 250) code += String(byte % 10);
      if (code.length === length) break;
    }
  }
  return code;
}
