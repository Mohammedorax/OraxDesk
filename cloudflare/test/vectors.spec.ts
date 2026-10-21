import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "../src/ratelimit";
import { canonicalString } from "../src/auth";
import { currentInvitationKeyId, openInvitation, sealInvitation, selectInvitationKey } from "../src/crypto";
import { b64urlDecode, b64urlEncode, hexDecode, hexEncode } from "../src/encoding";
import { endpointId } from "../src/id";

// Byte-for-byte vectors. If either side of the client/server pair drifts, these
// fail before a session is attempted.
describe("wire vectors", () => {
  it("canonical string is exactly as specified", () => {
    expect(
      canonicalString(
        "https://registry.example.com",
        "POST",
        "/v1/signals",
        "abc123",
        1_700_000_000,
        "nonce",
      ),
    ).toBe(
      "orax-device-auth-v2\nhttps://registry.example.com\nPOST\n/v1/signals\nabc123\n1700000000\nnonce",
    );
  });

  it("lowercases the method so a client cannot sign a different verb", () => {
    expect(
      canonicalString("https://r.example", "post", "/v1/signals", "abc", 1, "n"),
    ).toBe(canonicalString("https://r.example", "POST", "/v1/signals", "abc", 1, "n"));
  });

  it("binds the signature to the origin, so one registry cannot replay another's", () => {
    expect(canonicalString("https://a.example", "POST", "/v1/signals", "abc", 1, "n")).not.toBe(
      canonicalString("https://b.example", "POST", "/v1/signals", "abc", 1, "n"),
    );
  });

  it("derives the endpoint id as lower-case hex of the public key", () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => index);
    expect(endpointId(key)).toBe(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    );
    expect(endpointId(key)).toHaveLength(64);
  });

  it("encodes base64url without padding and round-trips bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = b64urlEncode(bytes);
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(Array.from(b64urlDecode(encoded))).toEqual(Array.from(bytes));
  });

  it("hex helpers round-trip and reject non-hex", () => {
    const bytes = Uint8Array.from([0x00, 0x0f, 0xa0, 0xff]);
    expect(hexEncode(bytes)).toBe("000fa0ff");
    expect(Array.from(hexDecode("000fa0ff"))).toEqual([0x00, 0x0f, 0xa0, 0xff]);
    expect(() => hexDecode("zz")).toThrow();
  });

  it("selects the sealing key by id and refuses unknown ids", () => {
    const keys = { current: "B", currentId: "k2", previous: "A", previousId: "k1" };
    expect(selectInvitationKey(keys, "k2")).toBe("B");
    expect(selectInvitationKey(keys, "k1")).toBe("A");
    expect(selectInvitationKey(keys, "k9")).toBeNull();
    // No rotation yet: everything was sealed under the default id.
    expect(selectInvitationKey({ current: "B" }, "k1")).toBe("B");
    expect(currentInvitationKeyId({ INVITATION_KEY_ID: "k2" })).toBe("k2");
    expect(currentInvitationKeyId({})).toBe("k1");
  });

  it("reads a row sealed under the previous key during rotation, and refuses it afterwards", async () => {
    const keyB64 = (fill: number) =>
      btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
    const oldKey = keyB64(1);
    const newKey = keyB64(2);
    const aad = "123456789012:1800000000";
    const sealed = await sealInvitation(oldKey, "boundary1:payload", aad);

    // Rotation window: the row says k1, the current key is k2, k1 is retained.
    const during = selectInvitationKey(
      { current: newKey, currentId: "k2", previous: oldKey, previousId: "k1" },
      "k1",
    );
    expect(during).toBe(oldKey);
    await expect(openInvitation(during!, sealed.ciphertext, sealed.nonce, aad)).resolves.toBe(
      "boundary1:payload",
    );

    // Window closed: no key is kept for k1, so the row fails closed.
    expect(selectInvitationKey({ current: newKey, currentId: "k2" }, "k1")).toBeNull();

    // The AAD binds the row to its code and expiry.
    await expect(openInvitation(oldKey, sealed.ciphertext, sealed.nonce, "other")).rejects.toThrow();
  });

  it("the fixed window limiter bounds attempts and recovers", () => {
    const limiter = new FixedWindowLimiter(2, 1_000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 1)).toBe(true);
    expect(limiter.allow("a", 2)).toBe(false);
    // A different address has its own window.
    expect(limiter.allow("b", 2)).toBe(true);
    // Time passing opens the window again.
    expect(limiter.allow("a", 1_001)).toBe(true);
  });

  it("evicts the oldest window, not every window", () => {
    // The bug this pins.
    //
    // The limiter used to CLEAR the whole map when it ran out of room, so ten
    // thousand distinct source addresses could wipe every honest client's
    // budget in one go. The key is the source address, and an attacker with a
    // single IPv6 /64 has ten thousand of them, so the limiter could be reset
    // at will by whoever it was there to stop.
    //
    // Under the old behaviour, "b" would have been reset along with "a", so
    // "b" would have been allowed again. Under the fixed one, "b" keeps its
    // budget and "a" is the one that is gone.
    const limiter = new FixedWindowLimiter(1, 60_000, 2);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 1)).toBe(true);
    // The map is full now, so the next key evicts the OLDEST window.
    expect(limiter.allow("c", 2)).toBe(true);

    // "b" is still at its limit: its window was not the one that was dropped.
    expect(limiter.allow("b", 3)).toBe(false);
    // "a" was evicted, so it starts again. That is the price of the eviction,
    // and it is bounded: ONE key, not all of them.
    expect(limiter.allow("a", 4)).toBe(true);
  });

  it("drops the expired windows before it drops a live one", () => {
    // The sweep is what makes the eviction rare: a key whose window has
    // closed is not a key worth keeping.
    const limiter = new FixedWindowLimiter(5, 100, 2);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 1)).toBe(true);
    // "a" has expired by now, so it is the one that goes.
    expect(limiter.allow("c", 200)).toBe(true);
    expect(limiter.allow("a", 201)).toBe(true);
    expect(limiter.allow("b", 202)).toBe(true);
  });
});
