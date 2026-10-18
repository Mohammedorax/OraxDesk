import { sweep } from "./cleanup";
import { invitationKeyStatus } from "./crypto";
import { getDevice, getDeviceByNumber, registerDevice, revokeDevice } from "./devices";
import { sha256Hex } from "./encoding";
import type { Env } from "./env";
import {
  ApiError,
  errorResponse,
  jsonResponse,
  parseObject,
  readBody,
  requireJsonContentType,
} from "./http";
import { resolveLimiter } from "./ratelimit";
import { createSignal, resolveSignal, revokeSignal } from "./signals";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
  /** Cron Trigger: bounded cleanup of dead codes, nonces and old audit rows. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweep(env));
  },
} satisfies ExportedHandler<Env>;

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  try {
    if (method === "GET" && path === "/healthz") return await health(env);

    if (method === "POST" && path === "/v1/devices") {
      requireJsonContentType(request);
      const raw = await readBody(request);
      return await registerDevice(env, request, parseObject(raw), raw);
    }

    if (path.startsWith("/v1/devices/by-number/")) {
      const number = path.slice("/v1/devices/by-number/".length);
      if (method === "GET" && !number.includes("/")) {
        return await getDeviceByNumber(env, number);
      }
    }

    if (path.startsWith("/v1/devices/")) {
      const rest = path.slice("/v1/devices/".length);
      if (method === "GET" && !rest.includes("/")) {
        return await getDevice(env, rest);
      }
      if (method === "POST" && rest.endsWith("/revoke")) {
        const id = rest.slice(0, -"/revoke".length);
        requireJsonContentType(request);
        const raw = await readBody(request);
        return await revokeDevice(env, request, id, await sha256Hex(raw.bytes));
      }
    }

    if (method === "POST" && path === "/v1/signals") {
      requireJsonContentType(request);
      const raw = await readBody(request);
      return await createSignal(env, request, parseObject(raw), await sha256Hex(raw.bytes));
    }

    if (method === "POST" && path === "/v1/signals/resolve") {
      // Per-isolate speed bump against code guessing; the single-use row is the
      // real bound. Edge rate limiting sits in front of this in production.
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      if (!resolveLimiter.allow(ip)) {
        throw new ApiError(429, "rate_limited", "Too many code attempts", {
          "retry-after": "60",
        });
      }
      requireJsonContentType(request);
      const raw = await readBody(request);
      return await resolveSignal(env, parseObject(raw));
    }

    if (method === "POST" && path === "/v1/signals/revoke") {
      requireJsonContentType(request);
      const raw = await readBody(request);
      return await revokeSignal(env, parseObject(raw));
    }

    throw new ApiError(404, "not_found", "No such endpoint");
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    // Never log headers, bodies or database messages: they can carry secrets.
    console.error(`${method} ${path} failed with ${(error as Error).name}`);
    return errorResponse(
      new ApiError(503, "unavailable", "The registry is temporarily unavailable", {
        "retry-after": "5",
      }),
    );
  }
}

async function health(env: Env): Promise<Response> {
  let dbOk = false;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const invitationKey = invitationKeyStatus(env.INVITATION_KEY);
  const healthy = dbOk && invitationKey === "ok";
  return jsonResponse(
    {
      status: healthy ? "ok" : "degraded",
      api: "v1",
      db: dbOk ? "ok" : "unavailable",
      invitation_key: invitationKey,
    },
    healthy ? 200 : 503,
  );
}
