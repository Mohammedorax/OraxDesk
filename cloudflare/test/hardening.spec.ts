import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { b64urlEncode, nowSeconds } from "../src/encoding";
import {
  createSignal,
  jsonBody,
  newDevice,
  register,
  resolveSignal,
  signedRequest,
  testDb,
} from "./helpers";

/**
 * The hardening: an audit trail that is actually written, a resolve that
 * cannot lose a session to a race, a last-seen that is recorded, and limits
 * that an anonymous caller cannot walk past.
 */
describe("the audit trail", () => {
  it("records a registration", async () => {
    const device = await newDevice();
    expect((await register(device)).status).toBe(201);
    const row = await testDb
      .prepare("SELECT kind, device_id FROM audit_events WHERE device_id = ?")
      .bind(device.id)
      .first<{ kind: string; device_id: string }>();
    expect(row?.kind).toBe("device.registered");
  });

  it("records a code being minted, resolved and withdrawn", async () => {
    const device = await newDevice();
    await register(device);
    const minted = await jsonBody<{ code: string; revoke_token: string }>(
      await createSignal(device, makeInvitation()),
    );

    await resolveSignal(minted.code);
    const resolved = await testDb
      .prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'signal.resolved'")
      .first<{ n: number }>();
    expect(resolved?.n).toBe(1);

    await SELF.fetch(
      new Request("https://registry.test/v1/signals/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revoke_token: minted.revoke_token }),
      }),
    );
    const withdrawn = await testDb
      .prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'signal.revoked'")
      .first<{ n: number }>();
    expect(withdrawn?.n).toBe(1);
  });

  it("records nothing that could be a secret", async () => {
    const device = await newDevice();
    await register(device);
    const minted = await jsonBody<{ code: string }>(
      await createSignal(device, makeInvitation()),
    );
    await resolveSignal(minted.code);
    const rows = await testDb
      .prepare("SELECT kind, device_id, detail FROM audit_events")
      .all<{ kind: string; device_id: string | null; detail: string | null }>();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const row of rows.results) {
      // The code itself is a capability. A prefix of it is not, and the
      // detail column is bounded, so a whole code could never fit.
      expect(row.detail ?? "").not.toContain(minted.code);
      expect((row.detail ?? "").length).toBeLessThanOrEqual(128);
    }
  });
});

describe("last seen", () => {
  it("is recorded when the device calls", async () => {
    const device = await newDevice();
    await register(device);
    // The call has to be one the Worker AUTHENTICATES, or it proves
    // nothing: `GET /v1/devices` is not a route, so it answered 404 and the
    // `last_seen_at` the assertion read was the one the REGISTRATION wrote.
    // The test passed for the wrong reason, and it passed only because the
    // registration and the call landed in the same second.
    //
    // Creating a code is an authenticated call, so it is the one that moves
    // the stamp.
    const before = nowSeconds();
    await createSignal(device, makeInvitation());
    const row = await testDb
      .prepare("SELECT last_seen_at FROM devices WHERE id = ?")
      .bind(device.id)
      .first<{ last_seen_at: number | null }>();
    expect(row?.last_seen_at).toBeGreaterThanOrEqual(before);
  });

  it("is in the public record", async () => {
    const device = await newDevice();
    await register(device);
    const body = await jsonBody<Record<string, unknown>>(
      await SELF.fetch(`https://registry.test/v1/devices/${device.id}`),
    );
    expect(typeof body.last_seen_at).toBe("number");
  });
});

describe("the resolve cannot lose a session", () => {
  it("gives the invitation to exactly one of two concurrent resolves", async () => {
    const device = await newDevice();
    await register(device);
    const minted = await jsonBody<{ code: string }>(
      await createSignal(device, makeInvitation()),
    );
    const [first, second] = await Promise.all([
      resolveSignal(minted.code),
      resolveSignal(minted.code),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 404]);
  });

  it("does not consume a code whose row is gone", async () => {
    const device = await newDevice();
    await register(device);
    const minted = await jsonBody<{ code: string }>(
      await createSignal(device, makeInvitation()),
    );
    // The row is gone before the resolve, so there is nothing to read and
    // the code reads as one that never existed. The helper gets a 404, and
    // the important part is that the code was NOT consumed on the way to
    // finding out: a code that is deleted is a code that is already spent.
    await testDb.prepare("DELETE FROM signal_codes WHERE code = ?").bind(minted.code).run();
    const response = await resolveSignal(minted.code);
    expect(response.status).toBe(404);
  });
});

describe("the origin is part of the signature", () => {
  it("refuses a signature made for another registry", async () => {
    const device = await newDevice();
    // Signed for one registry, sent to another. This is the replay the
    // origin binding exists to stop: without it, a signature captured at
    // one registry verifies at any other.
    const response = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        origin: "https://another-registry.test",
        sendTo: "https://registry.test",
        body: { public_key: b64urlEncode(device.publicKey) },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("accepts a signature made for the registry it is sent to", async () => {
    const device = await newDevice();
    const response = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        origin: "https://registry.test",
        body: { public_key: b64urlEncode(device.publicKey) },
      }),
    );
    expect(response.status).toBe(201);
  });

  it("refuses a signature replayed at another path", async () => {
    const device = await newDevice();
    await register(device);
    const request = await signedRequest("/v1/devices", device, {
      body: { public_key: b64urlEncode(device.publicKey) },
    });
    const headers = new Headers(request.headers);
    // The same signature, the same body, a different path. The path is part
    // of what is signed, so the revocation route cannot be reached with a
    // signature made for the registration route.
    const replay = await SELF.fetch(
      new Request(`https://registry.test/v1/devices/${device.id}/revoke`, {
        method: "POST",
        headers,
        body: await request.text(),
      }),
    );
    expect(replay.status).toBe(401);
  });
});

describe("the registry key is not the identity", () => {
  it("verifies the signature against the registry key when there is one", async () => {
    // Two keys: the identity, which is the device's id, and the registry
    // key, which signs. A signature made with the identity must not be
    // accepted once the device has registered a registry key, because that is
    // the whole point of having two.
    const device = await newDevice();
    const registry = await newDevice();
    const registered = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: {
          public_key: b64urlEncode(device.publicKey),
          registry_key: b64urlEncode(registry.publicKey),
        },
      }),
    );
    expect(registered.status).toBe(201);

    // The key is actually stored, and it is the one every later call is
    // checked against.
    const stored = await testDb
      .prepare("SELECT length(registry_key) AS n FROM devices WHERE id = ?")
      .bind(device.id)
      .first<{ n: number | null }>();
    expect(stored?.n).toBe(32);

    // A call signed with the IDENTITY is now refused.
    const withIdentity = await SELF.fetch(
      await signedRequest("/v1/signals", device, {
        body: { invitation: makeInvitation() },
      }),
    );
    expect(withIdentity.status).toBe(401);

    // A call signed with the REGISTRY key is accepted.
    const withRegistry = await SELF.fetch(
      await signedRequest("/v1/signals", registry, {
        body: { invitation: makeInvitation() },
        headers: { "x-orax-device": device.id },
      }),
    );
    expect(withRegistry.status).toBe(201);
  });

  it("refuses a registry key that is the device's own identity", async () => {
    const device = await newDevice();
    const response = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: {
          public_key: b64urlEncode(device.publicKey),
          registry_key: b64urlEncode(device.publicKey),
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("will not let the identity take the registry key back", async () => {
    // The hole this pins.
    //
    // A refresh used to be verified against the IDENTITY and to write the
    // offered registry key with COALESCE, which overwrites. So a leak of the
    // identity was a leak of the registry account: the holder could
    // re-register with a registry key of their own, sign every later call
    // with it, mint codes, publish an address and revoke the device, and the
    // legitimate owner was locked out of their own account.
    //
    // The identity is trusted by every machine that ever paired with this
    // one. It must not be enough to take the registry over.
    const device = await newDevice(true);
    const registered = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: {
          public_key: b64urlEncode(device.publicKey),
          registry_key: b64urlEncode(device.registryKey!),
        },
      }),
    );
    expect(registered.status).toBe(201);

    // A refresh signed with the identity is refused: the device is held to
    // the registry key it registered with.
    const refresh = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: {
          public_key: b64urlEncode(device.publicKey),
          registry_key: b64urlEncode(device.registryKey!),
        },
      }),
    );
    expect(refresh.status).toBe(401);

    // And the stored key is still the one that was registered.
    const stored = await testDb
      .prepare("SELECT registry_key FROM devices WHERE id = ?")
      .bind(device.id)
      .first<{ registry_key: ArrayBuffer | null }>();
    expect(stored?.registry_key).not.toBeNull();
    const bytes = new Uint8Array(stored!.registry_key!);
    expect(Array.from(bytes)).toEqual(Array.from(device.registryKey!));
  });

  it("refuses a refresh that offers a different registry key", async () => {
    // A device that already has a registry key is held to it. Silently
    // replacing it would make the stored key a claim rather than a fact, and
    // rotation is a server-side act: the column is cleared and the device
    // re-registers.
    const device = await newDevice(true);
    await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: {
          public_key: b64urlEncode(device.publicKey),
          registry_key: b64urlEncode(device.registryKey!),
        },
      }),
    );
    const other = await newDevice();
    const refresh = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: {
          public_key: b64urlEncode(device.publicKey),
          registry_key: b64urlEncode(other.publicKey),
        },
        signWithRegistryKey: true,
      }),
    );
    expect(refresh.status).toBe(400);
  });

  it("accepts a refresh signed with the registry key", async () => {
    const device = await newDevice(true);
    const body = {
      public_key: b64urlEncode(device.publicKey),
      registry_key: b64urlEncode(device.registryKey!),
    };
    expect(
      (
        await SELF.fetch(
          await signedRequest("/v1/devices", device, { body }),
        )
      ).status,
    ).toBe(201);
    // The second call is a refresh, and it is signed with the registry key.
    expect(
      (
        await SELF.fetch(
          await signedRequest("/v1/devices", device, {
            body,
            signWithRegistryKey: true,
          }),
        )
      ).status,
    ).toBe(200);
  });

  it("still accepts a device that sends no registry key", async () => {
    // The separation is adopted one device at a time, so a device that has
    // not been updated keeps working: the Worker falls back to the identity.
    const device = await newDevice();
    const response = await SELF.fetch(
      await signedRequest("/v1/devices", device, {
        body: { public_key: b64urlEncode(device.publicKey) },
      }),
    );
    expect(response.status).toBe(201);
    const signal = await SELF.fetch(
      await signedRequest("/v1/signals", device, {
        body: { invitation: makeInvitation() },
      }),
    );
    expect(signal.status).toBe(201);
  });
});

describe("the device directory", () => {
  it("publishes an address and reads it back", async () => {
    const device = await newDevice();
    await register(device);
    const address = {
      id: device.id,
      addrs: [{ Ip: "192.0.2.10:41234" }],
    };
    const published = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, device, {
        body: { address },
      }),
    );
    expect(published.status).toBe(204);

    const read = await SELF.fetch(`https://registry.test/v1/devices/${device.id}/address`);
    expect(read.status).toBe(200);
    const body = await jsonBody<{ id: string; addrs: unknown[] }>(read);
    expect(body.id).toBe(device.id);
    expect(body.addrs).toHaveLength(1);
  });

  it("refuses an address that is about a different device", async () => {
    const device = await newDevice();
    const other = await newDevice();
    await register(device);
    const response = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, device, {
        body: { address: { id: other.id, addrs: [] } },
      }),
    );
    expect(response.status).toBe(409);
  });

  it("refuses a publication signed by somebody else", async () => {
    const device = await newDevice();
    const stranger = await newDevice();
    await register(device);
    const response = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, stranger, {
        body: { address: { id: device.id, addrs: [] } },
        headers: { "x-orax-device": device.id },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("has no address for a device that published none", async () => {
    const device = await newDevice();
    await register(device);
    const response = await SELF.fetch(`https://registry.test/v1/devices/${device.id}/address`);
    expect(response.status).toBe(404);
  });

  it("reads an expired address as no address at all", async () => {
    // The address is true for an hour. After that it is a place the machine
    // is not, and a helper that found it would knock on a stranger's door.
    const device = await newDevice();
    await register(device);
    const published = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, device, {
        body: { address: { id: device.id, addrs: [{ Ip: "192.0.2.10:41234" }] } },
      }),
    );
    expect(published.status).toBe(204);

    const fresh = await SELF.fetch(`https://registry.test/v1/devices/${device.id}/address`);
    expect(fresh.status).toBe(200);

    // One second past the hour.
    await testDb
      .prepare("UPDATE devices SET address_at = ? WHERE id = ?")
      .bind(nowSeconds() - 3601, device.id)
      .run();
    const expired = await SELF.fetch(`https://registry.test/v1/devices/${device.id}/address`);
    expect(expired.status).toBe(404);
  });

  it("refuses an address whose host is not an IP literal", async () => {
    // A host that is a NAME is free text, and free text is where a secret
    // goes. The guarantee the directory makes is about the shape of what is
    // stored, so the shape has to exclude a name.
    const device = await newDevice();
    await register(device);
    const response = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, device, {
        body: {
          address: {
            id: device.id,
            addrs: [{ Ip: "SECRETKEYHERE:41234" }],
          },
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a relay address that carries a fragment", async () => {
    // A URL fragment is never sent to the server, so it is free text that
    // would be stored verbatim and read back to every helper.
    const device = await newDevice();
    await register(device);
    const response = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, device, {
        body: {
          address: {
            id: device.id,
            addrs: [{ Relay: "https://relay.example/#something" }],
          },
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("stores only the address, never anything else that was offered", async () => {
    // The address is where a machine can be reached. It is not a way in:
    // iroh's handshake authenticates the peer by its key, so the address is a
    // place to knock and never a credential. What must never end up here is
    // the session secret, which is the one thing that IS a credential.
    //
    // An address that carries anything else is REFUSED outright, rather than
    // stored with the extra field quietly dropped: a blob with a field the
    // registry does not understand is a malformed address, and the same rule
    // the rest of the API follows.
    const device = await newDevice();
    await register(device);
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)));
    const refused = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, device, {
        body: {
          address: {
            id: device.id,
            addrs: [{ Ip: "192.0.2.10:41234" }],
            secret,
          },
        },
      }),
    );
    expect(refused.status).toBe(400);
    const row = await testDb
      .prepare("SELECT address FROM devices WHERE id = ?")
      .bind(device.id)
      .first<{ address: string | null }>();
    expect(row?.address).toBeNull();

    // And what a well formed address stores is the address and nothing else.
    const published = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, device, {
        body: { address: { id: device.id, addrs: [{ Ip: "192.0.2.10:41234" }] } },
      }),
    );
    expect(published.status).toBe(204);
    const stored = await testDb
      .prepare("SELECT address FROM devices WHERE id = ?")
      .bind(device.id)
      .first<{ address: string | null }>();
    const parsed = JSON.parse(stored?.address ?? "{}") as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["addrs", "id"]);
    expect(JSON.stringify(parsed)).not.toContain(JSON.stringify(secret));
  });

  it("refuses an address entry that is not an address", async () => {
    const device = await newDevice();
    await register(device);
    const response = await SELF.fetch(
      await signedRequest(`/v1/devices/${device.id}/address`, device, {
        body: {
          address: {
            id: device.id,
            addrs: [{ NotAnAddress: "whatever" }],
          },
        },
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("the device number", () => {
  it("gives a device another number rather than refusing it forever", async () => {
    // The number is DERIVED from the key, so two devices can derive the same
    // one. The space is a billion, so it is rare, and it gets rarer as the
    // registry grows.
    //
    // It still has to be handled, because the failure was not "one device has
    // a different number": it was that the UNIQUE index refused the insert,
    // the refusal came back as a 500, and the device could NEVER register.
    // The number comes from its identity, so retrying changed nothing. A
    // computer that cannot register is a computer nobody can help.
    //
    // So the second device is given the next free number, and it is told
    // which one, because the number is what a person reads out loud.
    const first = await newDevice();
    const second = await newDevice();

    // The first device takes the number derived from its key.
    const registered = await register(first);
    expect(registered.status).toBe(201);
    const firstBody = await jsonBody<{ number: string }>(registered);
    expect(firstBody.number).toBe(await derivedNumber(first.publicKey));

    // The second device's number is now taken: the first device is moved
    // onto it, which is exactly what a collision looks like from the
    // registry's side.
    const secondNumber = await derivedNumber(second.publicKey);
    expect(secondNumber).not.toBe(firstBody.number);
    const taken = await testDb
      .prepare("UPDATE devices SET number = ? WHERE id = ?")
      .bind(secondNumber, first.id)
      .run();
    expect(taken.meta.changes).toBe(1);

    const collided = await register(second);
    expect(collided.status).toBe(201);
    const secondBody = await jsonBody<{ number: string }>(collided);
    // A different number, and a real one.
    expect(secondBody.number).not.toBe(secondNumber);
    expect(secondBody.number).toMatch(/^\d{9}$/);
    // And it is the number the registry stored, so a helper can look it up.
    const stored = await testDb
      .prepare("SELECT number FROM devices WHERE id = ?")
      .bind(second.id)
      .first<{ number: string }>();
    expect(stored?.number).toBe(secondBody.number);
  });

  it("keeps the number a registered device already has", async () => {
    // A refresh must not move a device to a different number: the number is
    // on a screen and in a conversation, and a number that changes under
    // the person who read it out is worse than one that was never unique.
    const device = await newDevice();
    await register(device);
    const first = await jsonBody<{ number: string }>(
      await register(device),
    );
    const moved = await testDb
      .prepare("UPDATE devices SET number = ? WHERE id = ?")
      .bind("999999999", device.id)
      .run();
    expect(moved.meta.changes).toBe(1);
    const again = await jsonBody<{ number: string }>(await register(device));
    expect(again.number).toBe("999999999");
  });
});

/**
 * The number a key derives, the way the registry derives it.
 *
 * The test needs it because a collision is two devices deriving the SAME
 * number, and two keys with the same derivation cannot be made. So the
 * registry's own rule is used to move one device onto the other's number,
 * which is what a collision looks like from its side.
 */
async function derivedNumber(publicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", publicKey as unknown as BufferSource),
  );
  const value =
    ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return String(value % 1_000_000_000).padStart(9, "0");
}

describe("the limits", () => {
  it("refuses a flood of registrations from one address", async () => {
    // The limiter is per isolate, so this is a speed bump rather than a
    // quota. What it has to be is more than nothing: a flood of
    // registrations writes device rows that nothing ever deletes.
    //
    // The flood comes from ONE address, because that is the shape of the
    // attack: one source, many identities. Each device it registers is a new
    // identity, and they all share the source address, so the budget they
    // share is the budget under test.
    //
    // The count is exact rather than "more than none", because a test that
    // passes when the limit is raised is not testing the limit.
    const source = "10.99.99.99";
    let refused = 0;
    let accepted = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const device = await newDevice();
      const response = await SELF.fetch(
        await signedRequest("/v1/devices", device, {
          body: { public_key: b64urlEncode(device.publicKey) },
          ip: source,
        }),
      );
      if (response.status === 429) refused += 1;
      if (response.status === 201) accepted += 1;
    }
    // The limiter allows twenty registrations a minute per address.
    expect(accepted).toBe(20);
    expect(refused).toBe(10);
  });
});

function makeInvitation(seconds = 300): string {
  const payload = {
    version: 1,
    address: { id: "a".repeat(64), ip_addrs: [], relay_urls: [] },
    secret: Array.from(crypto.getRandomValues(new Uint8Array(32))),
    expires: nowSeconds() + seconds,
  };
  return `boundary1:${b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;
}
