import { SELF, env as rawEnv } from "cloudflare:test";
import { canonicalString } from "../src/auth";
import { b64urlEncode, hexEncode, nowSeconds, sha256Hex } from "../src/encoding";

// `cloudflare:test` types `env` as the global Env interface, which the plugin's
// types do not let this project augment in a way TypeScript picks up in tests.
// One cast here keeps every spec typed without sprinkling casts through them.
export const testBindings = rawEnv as unknown as {
  DB: D1Database;
  INVITATION_KEY: string;
  TEST_MIGRATIONS: unknown[];
};
export const testDb = testBindings.DB;

export interface TestDevice {
  id: string;
  publicKey: Uint8Array;
  privateKey: CryptoKey;
  /**
   * The source address this device's requests come from.
   *
   * The registration limiter is keyed on the source address, and in the test
   * environment every request would otherwise come from the same one, so the
   * whole file would share a single budget of twenty registrations a minute.
   * A test file that runs out of budget because a test was ADDED is a test
   * file that breaks for no reason, and the flood test cannot be given a
   * budget of its own either.
   *
   * Cloudflare sets this header itself in production and a client cannot
   * forge it; in a test the client IS the caller, so the test sets it.
   */
  ip: string;
  /**
   * A second key for the same device: the REGISTRY key.
   *
   * It is what the API calls are signed with once a device has one, and the
   * identity is what the FIRST registration is signed with, because the
   * Worker cannot verify against a key it has not been told yet.
   */
  registryKey?: Uint8Array;
  registryPrivateKey?: CryptoKey;
}

/**
 * A source address for one test device.
 *
 * Every device gets its own, so the limiter's budget is per device and a
 * test cannot spend another's.
 */
let deviceCounter = 0;
function nextIp(): string {
  deviceCounter += 1;
  return `10.${Math.floor(deviceCounter / 65536) % 256}.${Math.floor(deviceCounter / 256) % 256}.${deviceCounter % 256}`;
}

export async function newDevice(withRegistryKey = false): Promise<TestDevice> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  if (!withRegistryKey) {
    return {
      id: hexEncode(publicKey),
      publicKey,
      privateKey: pair.privateKey,
      ip: nextIp(),
    };
  }
  const registry = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return {
    id: hexEncode(publicKey),
    publicKey,
    privateKey: pair.privateKey,
    ip: nextIp(),
    registryKey: new Uint8Array(
      (await crypto.subtle.exportKey("raw", registry.publicKey)) as ArrayBuffer,
    ),
    registryPrivateKey: registry.privateKey,
  };
}

export function freshNonce(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

export interface SignOptions {
  method?: string;
  body?: unknown;
  timestamp?: number;
  nonce?: string;
  headers?: Record<string, string>;
  /** The origin the request is signed for. Defaults to the test origin. */
  origin?: string;
  /**
   * Where the request is actually SENT, when that is not the origin it was
   * signed for.
   *
   * A request is always sent to the origin it was signed for otherwise, which
   * is the whole point: the origin is what makes a signature useless
   * anywhere else. This option exists to send a signature made for one
   * registry to ANOTHER one, which is the replay the origin binding exists to
   * stop.
   */
  sendTo?: string;
  /**
   * Sign with the REGISTRY key instead of the identity.
   *
   * The device is still NAMED by the identity: the header carries the same
   * id. Only the key the signature is made with changes, which is exactly
   * what happens on the wire.
   */
  signWithRegistryKey?: boolean;
  /**
   * The source address to send the request from.
   *
   * Defaults to the device's own, so a device's requests all come from one
   * address and the limiter's budget is per device.
   */
  ip?: string;
}

/** Builds a request signed exactly the way a client must sign it. */
export async function signedRequest(
  path: string,
  device: TestDevice,
  options: SignOptions = {},
): Promise<Request> {
  const method = (options.method ?? "POST").toUpperCase();
  const bodyText = options.body === undefined ? "" : JSON.stringify(options.body);
  const bytes = new TextEncoder().encode(bodyText);
  const bodyHash = await sha256Hex(bytes);
  const timestamp = options.timestamp ?? nowSeconds();
  const nonce = options.nonce ?? freshNonce();
  const origin = options.origin ?? "https://registry.test";
  const canonical = canonicalString(origin, method, path, bodyHash, timestamp, nonce);
  const signingKey =
    options.signWithRegistryKey && device.registryPrivateKey !== undefined
      ? device.registryPrivateKey
      : device.privateKey;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      signingKey,
      new TextEncoder().encode(canonical),
    ),
  );
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-orax-device": device.id,
    "x-orax-timestamp": String(timestamp),
    "x-orax-nonce": nonce,
    "x-orax-signature": b64urlEncode(signature),
    "cf-connecting-ip": options.ip ?? device.ip,
    ...options.headers,
  };
  return new Request(`${options.sendTo ?? origin}${path}`, {
    method,
    headers,
    body: method === "GET" || bodyText === "" ? undefined : bodyText,
  });
}

export async function register(
  device: TestDevice,
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  const body = {
    public_key: b64urlEncode(device.publicKey),
    label: "Reception PC",
    client_version: "0.30.0",
    protocol_version: 1,
    ...overrides,
  };
  return SELF.fetch(await signedRequest("/v1/devices", device, { body }));
}

export function makeInvitation(expiresInSeconds = 300, version = 1): string {
  const payload = {
    version,
    address: { id: "a".repeat(64), ip_addrs: [], relay_urls: [] },
    secret: Array.from(crypto.getRandomValues(new Uint8Array(32))),
    expires: nowSeconds() + expiresInSeconds,
  };
  return `boundary1:${b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;
}

export async function createSignal(
  device: TestDevice,
  invitation: string,
  extra: Record<string, unknown> = {},
  nonce?: string,
): Promise<Response> {
  return SELF.fetch(
    await signedRequest("/v1/signals", device, {
      body: { invitation, ttl_seconds: 300, ...extra },
      nonce,
    }),
  );
}

export async function resolveSignal(code: string): Promise<Response> {
  return SELF.fetch(
    new Request("https://registry.test/v1/signals/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
}

export async function jsonBody<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
