/**
 * The device directory: where a machine is, so a helper can reach it by its
 * id alone.
 *
 * This is ADDRESS data, not session data. The screen, the mouse and the
 * keyboard never come near it: iroh's QUIC handshake authenticates the peer
 * by its key, so an address is a place to knock and never a way in. That is
 * the same reason iroh's own public directory publishes addresses.
 *
 * What it buys: a machine is reachable by its id without anybody reading a
 * sixty-four character id down the phone, and a deployment does not have to
 * depend on somebody else's directory to find its own machines.
 *
 * What it does not buy, and this is deliberate: nothing here decides who may
 * connect. That decision is the machine's own, in its access file, and it is
 * made when the connection arrives. A directory that could say no would be a
 * directory with authority over machines, and this one has none.
 */
import { authenticate } from "./auth";
import { audit } from "./audit";
import { ApiError, jsonResponse, parseObject, rejectUnknownKeys } from "./http";
import type { Env } from "./env";

/**
 * The address a device published.
 *
 * The shape is the same one the `boundary1:` invitation carries, so there is
 * one address format in the project and not two.
 */
interface PublishedAddress {
  id: string;
  addrs: unknown[];
}

/**
 * Check that an address is an address and nothing else.
 *
 * The address is stored as it was offered, so an address blob that is
 * accepted as-is is a place anything can be put. That matters because the
 * invitation's `secret` is a credential, and a registry that accepts a
 * secret-shaped field in an address is a registry that ends up holding one.
 *
 * So the address is taken apart and put back together from what is
 * understood: the device id, and a list of transport addresses that are
 * either a socket address or a relay URL. Everything else is refused.
 */
function sanitizeAddress(value: unknown): PublishedAddress {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "bad_request", "address must be an object");
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "id" && key !== "addrs") {
      throw new ApiError(400, "bad_request", `address.${key} is not part of an address`);
    }
  }
  const id = raw.id;
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) {
    throw new ApiError(400, "bad_request", "address.id must be a 64 character hex device id");
  }
  if (!Array.isArray(raw.addrs)) {
    throw new ApiError(400, "bad_request", "address.addrs must be a list");
  }
  if (raw.addrs.length > 16) {
    throw new ApiError(400, "bad_request", "an address does not have sixteen transport addresses");
  }
  const addrs: unknown[] = [];
  for (const entry of raw.addrs) {
    addrs.push(sanitizeTransportAddr(entry));
  }
  return { id, addrs };
}

/**
 * One transport address: a socket address, or a relay URL.
 *
 * Nothing else is a transport address, and nothing else is kept.
 */
function sanitizeTransportAddr(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "bad_request", "an address entry must be an object");
  }
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new ApiError(400, "bad_request", "an address entry has exactly one field");
  }
  const kind = keys[0];
  if (kind === undefined) {
    throw new ApiError(400, "bad_request", "an address entry has exactly one field");
  }
  const inner = entry[kind];
  if (typeof inner !== "string") {
    throw new ApiError(400, "bad_request", "an address entry must be a string");
  }
  if (kind === "Ip") {
    // A socket address: a host and a port, nothing else.
    if (!/^[0-9a-zA-Z.:%\-[\]]+:\d{1,5}$/.test(inner)) {
      throw new ApiError(400, "bad_request", "an Ip address must be a host and a port");
    }
    return { Ip: inner };
  }
  if (kind === "Relay") {
    // A relay URL: http or https, no credentials, no path.
    let parsed: URL;
    try {
      parsed = new URL(inner);
    } catch {
      throw new ApiError(400, "bad_request", "a relay address must be a URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ApiError(400, "bad_request", "a relay address must be http or https");
    }
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search) {
      throw new ApiError(400, "bad_request", "a relay address carries nothing but an origin");
    }
    return { Relay: inner };
  }
  throw new ApiError(400, "bad_request", "an address entry is a socket address or a relay URL");
}

/**
 * How long a published address stays true.
 *
 * A device that changes network publishes again, and iroh calls the
 * publisher whenever the address changes. This is the backstop for a device
 * that went away without publishing, and it is why a helper that finds a
 * stale address fails to connect rather than connecting to the wrong place.
 */
const ADDRESS_TTL_SECONDS = 60 * 60;

/**
 * Publish this device's address, so a helper can find it by id.
 *
 * Signed by the device, like every other write here: a third party must not
 * be able to point a helper at a machine of their choosing.
 */
export async function publishAddress(
  env: Env,
  request: Request,
  id: string,
  body: Record<string, unknown>,
  bodySha256Hex: string,
): Promise<Response> {
  rejectUnknownKeys(body, ["address"]);
  if (body.address === undefined || body.address === null) {
    throw new ApiError(400, "bad_request", "address is required");
  }
  // Taken apart and put back together from what is understood, so an address
  // blob cannot carry anything else.
  const address = sanitizeAddress(body.address);
  if (address.id !== id) {
    throw new ApiError(409, "conflict", "the published address is for a different device");
  }
  // The body is signed, so the address cannot be swapped on the way in.
  const auth = await authenticate(env, request, bodySha256Hex);
  if (auth.id !== id) {
    throw new ApiError(403, "forbidden", "a device can only publish its own address");
  }
  // The address is a bounded blob. It is a handful of socket addresses and a
  // relay URL, and a body that claims otherwise is not an address.
  const encoded = JSON.stringify(address);
  if (encoded.length > 4096) {
    throw new ApiError(400, "bad_request", "the address is too large");
  }
  const now = nowSeconds();
  await env.DB.prepare(
    "UPDATE devices SET address = ?, address_at = ? WHERE id = ?",
  )
    .bind(encoded, now, id)
    .run();
  await audit(env, "address.published", id);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/**
 * The address a device published.
 *
 * Public, like the address directory iroh already uses, and for the same
 * reason: the address is a place to knock, and the handshake is what decides
 * whether the knock is answered. A helper that knows the id can find the
 * address here; a helper that does not know the id learns nothing.
 *
 * The nine digit number is a lookup key and NOT a secret: it resolves to the
 * id, and the id resolves to the address. That is the price of reading a
 * number down the phone, and it is why this endpoint is limited.
 */
export async function fetchAddress(env: Env, id: string): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw new ApiError(400, "bad_request", "Invalid device id");
  }
  const row = await env.DB.prepare(
    "SELECT address, address_at FROM devices WHERE id = ?",
  )
    .bind(id)
    .first<{ address: string | null; address_at: number | null }>();
  if (row === null || row.address === null) {
    throw new ApiError(404, "not_found", "No such device");
  }
  // A stale address is no address. A device that changed network and did not
  // publish again would otherwise send a helper to a place the machine is
  // not any more.
  const age = row.address_at === null ? Infinity : nowSeconds() - row.address_at;
  if (age > ADDRESS_TTL_SECONDS) {
    throw new ApiError(404, "not_found", "No such device");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.address);
  } catch {
    throw new ApiError(404, "not_found", "No such device");
  }
  return jsonResponse(parsed);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
