import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { jsonBody, newDevice, register } from "./helpers";

describe("device numbers", () => {
  it("gives every device a stable nine-digit number other people can type", async () => {
    const device = await newDevice();
    const created = await register(device);
    const body = await jsonBody<{ number: string }>(created);
    expect(body.number).toMatch(/^\d{9}$/);

    // The same key always yields the same number, across re-registration.
    const again = await register(device);
    expect((await jsonBody<{ number: string }>(again)).number).toBe(body.number);

    const byNumber = await SELF.fetch(
      new Request(`https://registry.test/v1/devices/by-number/${body.number}`, {
        headers: { "cf-connecting-ip": "203.0.113.8" },
      }),
    );
    expect(byNumber.status).toBe(200);
    expect((await jsonBody(byNumber)).id).toBe(device.id);

    // A revoked device keeps its number but the record says so.
    await SELF.fetch(`https://registry.test/v1/devices/${device.id}`);
    const lookup = (number: string) =>
      SELF.fetch(
        new Request(`https://registry.test/v1/devices/by-number/${number}`, {
          headers: { "cf-connecting-ip": "203.0.113.8" },
        }),
      );
    expect((await lookup("12345")).status).toBe(400);
    expect((await lookup("999999999")).status).toBe(404);
  });
});
