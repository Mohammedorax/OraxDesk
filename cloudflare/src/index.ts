import { sweep } from "./cleanup";
import { invitationKeyStatus, isDevelopmentInvitationKey } from "./crypto";
import { fetchAddress, publishAddress } from "./directory";
import { getDevice, getDeviceByNumber, registerDevice, revokeDevice, revokeDeviceAsOperator } from "./devices";
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
import { resolveLimiter, directoryLimiter, registerLimiter, adminLimiter } from "./ratelimit";
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
      // Registration is the one endpoint with no limit of its own, and every
      // registration writes a device row that nothing ever deletes. An
      // anonymous caller could fill the table with keys it had minted a
      // moment earlier.
      //
      // The limiter is per isolate, so this is a speed bump rather than a
      // quota: the real bound is the edge rate limiting in front of the
      // Worker, which is not configured in this repository and is therefore
      // an operational assumption rather than something this code can rely
      // on. What this does is make the cheap abuse expensive.
      if (!registerLimiter.allow(clientIp(request))) {
        throw new ApiError(429, "rate_limited", "Too many registrations from this address", {
          "retry-after": "60",
        });
      }
      requireJsonContentType(request);
      const raw = await readBody(request);
      return await registerDevice(env, request, parseObject(raw), raw);
    }

    if (path.startsWith("/v1/devices/by-number/")) {
      const number = path.slice("/v1/devices/by-number/".length);
      if (method === "GET" && !number.includes("/")) {
        // The nine digit number is a BILLION values read one at a time with
        // no authentication, so this is the one endpoint where a flood is
        // cheap. It gets the tightest window of the three.
        if (!directoryLimiter.allow(clientIp(request))) {
          throw new ApiError(429, "rate_limited", "Too many lookups from this address", {
            "retry-after": "60",
          });
        }
        return await getDeviceByNumber(env, number);
      }
    }

    // Operator revocation. The handler itself answers 404 when no operator
    // token is configured, so this route exists in the code and not in the
    // deployment's surface.
    if (method === "POST" && path.startsWith("/v1/admin/devices/")) {
      const rest = path.slice("/v1/admin/devices/".length);
      if (rest.endsWith("/revoke")) {
        if (!adminLimiter.allow(clientIp(request))) {
          throw new ApiError(429, "rate_limited", "Too many operator calls", {
            "retry-after": "60",
          });
        }
        requireJsonContentType(request);
        const raw = await readBody(request);
        return await revokeDeviceAsOperator(
          env,
          request,
          rest.slice(0, -"/revoke".length),
          parseObject(raw),
        );
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
      // The device directory: where a machine is, so a helper can reach it by
      // its id alone. The address is ADDRESS data, never session data.
      if (method === "POST" && rest.endsWith("/address")) {
        const id = rest.slice(0, -"/address".length);
        requireJsonContentType(request);
        const raw = await readBody(request);
        return await publishAddress(
          env,
          request,
          id,
          parseObject(raw),
          await sha256Hex(raw.bytes),
        );
      }
      if (method === "GET" && rest.endsWith("/address")) {
        const id = rest.slice(0, -"/address".length);
        return await fetchAddress(env, id);
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
      if (!resolveLimiter.allow(clientIp(request))) {
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

/**
 * The caller's address, as Cloudflare saw it.
 *
 * Required, not defaulted. A request that reached the Worker without the
 * header shared one "unknown" budget with every other such request, so one
 * client behind a misconfigured origin could exhaust it for everybody. There
 * is no legitimate path to the Worker that lacks the header, so a request
 * without it is refused rather than lumped together with the rest.
 */
function clientIp(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip");
  if (ip === null || ip === "") {
    throw new ApiError(400, "bad_request", "The request did not come through Cloudflare");
  }
  return ip;
}

async function health(env: Env): Promise<Response> {
  let dbOk = false;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const invitationKey = isDevelopmentInvitationKey(env.INVITATION_KEY) && env.ALLOW_TEST_KEY !== "1"
    ? "development"
    : invitationKeyStatus(env.INVITATION_KEY);
  const healthy = dbOk && invitationKey === "ok";
  return jsonResponse(
    {
      status: healthy ? "ok" : "degraded",
      api: "v1",
      db: dbOk ? "ok" : "unavailable",
      invitation_key: invitationKey,
      // A device whose clock is wrong can still sign a request correctly by
      // measuring this against its own clock. Date is a fallback for older
      // Workers; this field gives the same answer without parsing a header.
      server_time: Math.floor(Date.now() / 1000),
    },
    healthy ? 200 : 503,
  );
}
