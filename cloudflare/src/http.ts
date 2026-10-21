import { MAX_BODY_BYTES } from "./constants";

const BASE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

/** Every failure the client should see is one of these; nothing else escapes. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extraHeaders: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(error: ApiError): Response {
  return jsonResponse(
    { error: { code: error.code, message: error.message } },
    error.status,
    error.extraHeaders,
  );
}

export interface RawBody {
  raw: string;
  bytes: Uint8Array;
}

/**
 * Reads the body once, with a hard byte cap. The cap is enforced on the actual
 * bytes, not on what the client declared, so a chunked request cannot grow
 * past it.
 */
export async function readBody(request: Request): Promise<RawBody> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large");
  }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ApiError(400, "bad_request", "Body is not valid UTF-8");
  }
  return { raw, bytes };
}

export function requireJsonContentType(request: Request): void {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
}

export function parseObject(body: RawBody): Record<string, unknown> {
  if (body.bytes.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(body.raw);
  } catch {
    throw new ApiError(400, "bad_request", "Body is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, "bad_request", "Body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/**
 * Refuse a body that carries fields this endpoint does not accept.
 *
 * The code is `unknown_field` and not `bad_request`, and the difference
 * matters to a client. A registry that does not know a field is an OLD
 * registry, and a client can work around that by dropping the field. A
 * registry that refuses a body for any other reason is telling the client
 * something about the body, and dropping the field to make the error go away
 * would throw away what the client was trying to say.
 */
export function rejectUnknownKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new ApiError(
      400,
      "unknown_field",
      "Body contains fields this endpoint does not accept",
    );
  }
}

export function requiredString(
  value: unknown,
  name: string,
  maxChars: number,
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) {
    throw new ApiError(400, "bad_request", `${name} is missing or too long`);
  }
  return value;
}

export function optionalString(
  value: unknown,
  name: string,
  maxChars: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > maxChars) {
    throw new ApiError(400, "bad_request", `${name} is too long`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApiError(400, "bad_request", `${name} contains control characters`);
  }
  return value;
}

export function optionalInt(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(400, "bad_request", `${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}
