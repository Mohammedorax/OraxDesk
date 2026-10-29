import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isDevelopmentInvitationKey } from "../src/crypto";
import type { Env } from "../src/env";
import { createSignal } from "../src/signals";

const DEV_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";

describe("the development invitation key", () => {
  it("is recognised, including with surrounding whitespace", () => {
    expect(isDevelopmentInvitationKey(DEV_KEY)).toBe(true);
    expect(isDevelopmentInvitationKey(`  ${DEV_KEY}\n`)).toBe(true);
    expect(isDevelopmentInvitationKey("not-the-key")).toBe(false);
    expect(isDevelopmentInvitationKey(undefined)).toBe(false);
  });

  it("is refused for minting codes unless the deployment opts in", async () => {
    // Called directly: the refusal happens before authentication, so no
    // signed request is needed to reach it.
    const base = { DB: env.DB, INVITATION_KEY: DEV_KEY } as Env;
    const request = new Request("https://registry.test/v1/signals", {
      method: "POST",
      body: "{}",
    });
    await expect(createSignal(base, request, {}, "hash")).rejects.toMatchObject({
      status: 503,
    });

    // With the explicit local-development opt-in the guard passes, and the
    // next thing that refuses is the missing signature (401) rather than the
    // key.
    const local = { ...base, ALLOW_TEST_KEY: "1" };
    await expect(createSignal(local, request, {}, "hash")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("keeps the test deployment's health green because it opted in", async () => {
    // The vitest bindings set ALLOW_TEST_KEY, so the same key reports "ok"
    // here. Without that opt-in /healthz answers status "degraded" and
    // invitation_key "development".
    const response = await SELF.fetch("https://registry.test/healthz");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { invitation_key: string };
    expect(body.invitation_key).toBe("ok");
  });
});
