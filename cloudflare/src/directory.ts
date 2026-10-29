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
import { ADDRESS_TTL_SECONDS } from "./constants";
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
    const clean = sanitizeTransportAddr(entry);
    // A transport kind this build does not understand is SKIPPED, not refused.
    // Refusing poisoned the whole publish: iroh publishes every address it
    // discovered, dual-stack machines contribute both families, and a `Custom`
    // entry (or an IPv6 literal, before it was accepted) made `sanitizeAddress`
    // throw a 400, so the machine never appeared in the directory at all. What
    // this module guarantees is the SHAPE of what it stores, and an entry that
    // cannot be shape-checked is not stored.
    if (clean !== null) addrs.push(clean);
  }
  return { id, addrs };
}

/**
 * One transport address: a socket address, or a relay URL.
 *
 * Returns null for a kind this build does not know, so the caller can skip it.
 */
function sanitizeTransportAddr(value: unknown): unknown | null {
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
    //
    // The host is an IP LITERAL and not a name. A name would be free text,
    // and free text is where a secret goes: the guarantee this module makes
    // is about the SHAPE of what is stored, and a shape that admits any
    // string in the host position is no guarantee at all.
    //
    // Both families are accepted. IPv4 gets its octets checked (the regex
    // alone would take 999.999.999.999), IPv6 is parsed by the URL parser
    // rather than by a regex that would be wrong somewhere. iroh's
    // `SocketAddr` serializes as `Display`, so a v6 literal arrives as
    // `[2001:db8::1]:41234`.
    let hostOk = false;
    let portText = "";
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(inner);
    if (v4 !== null) {
      hostOk = v4.slice(1, 5).every((octet) => Number(octet) <= 255);
      portText = v4[5];
    } else {
      const v6 = /^\[([0-9a-fA-F:.]+)\]:(\d{1,5})$/.exec(inner);
      if (v6 !== null) {
        try {
          // The URL parser is the authority on what a valid IPv6 literal is.
          const parsedHost = new URL(`http://[${v6[1]}]/`).hostname;
          hostOk = parsedHost.startsWith("[") && parsedHost.endsWith("]");
        } catch {
          hostOk = false;
        }
        portText = v6[2];
      }
    }
    if (!hostOk) {
      throw new ApiError(400, "bad_request", "an Ip address must be an IP literal and a port");
    }
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ApiError(400, "bad_request", "an Ip address must carry a real port");
    }
    return { Ip: inner };
  }
  if (kind === "Relay") {
    // A relay URL: http or https, no credentials, no query, no fragment. A
    // PATH is allowed: a self-hosted relay can live under one, and refusing
    // it took the whole publish down with it.
    let parsed: URL;
    try {
      parsed = new URL(inner);
    } catch {
      throw new ApiError(400, "bad_request", "a relay address must be a URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ApiError(400, "bad_request", "a relay address must be http or https");
    }
    // The FRAGMENT is checked with the rest. A URL fragment is never sent to
    // the server, so it is free text that would be stored verbatim and read
    // back to every helper that looks the address up. Same for a query: a
    // relay URL with `?token=…` is a credential in a public directory.
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new ApiError(400, "bad_request", "a relay address carries no credentials, query or fragment");
    }
    return { Relay: `${parsed.origin}${parsed.pathname}` };
  }
  // Not a transport kind this build knows. Skipped by the caller.
  return null;
}

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
