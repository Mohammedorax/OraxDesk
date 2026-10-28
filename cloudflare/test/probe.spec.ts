import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { testBindings } from "./helpers";

// Platform capabilities the API depends on. If either of these is missing the
// design has to change before any handler is written, so they are asserted
// first and on their own.
describe("runtime capabilities", () => {
  it("verifies Ed25519 signatures with WebCrypto", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const message = new TextEncoder().encode("orax-probe");
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, message);
    const raw = new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    );
    expect(raw.length).toBe(32);

    const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    await expect(
      crypto.subtle.verify({ name: "Ed25519" }, key, signature, message),
    ).resolves.toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await expect(
      crypto.subtle.verify({ name: "Ed25519" }, key, signature, tampered),
    ).resolves.toBe(false);
  });

  it("seals and opens AES-GCM with additional data", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(atob(testBindings.INVITATION_KEY), (c) => c.charCodeAt(0)),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode("123456789012:1000");
    const plain = new TextEncoder().encode("boundary1:payload");
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad },
      key,
      plain,
    );
    const opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad },
      key,
      sealed,
    );
    expect(new TextDecoder().decode(opened)).toBe("boundary1:payload");

    await expect(
      crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode("other") },
        key,
        sealed,
      ),
    ).rejects.toThrow();
  });

  it("healthz reports database and configuration", async () => {
    const response = await SELF.fetch("https://registry.test/healthz");
    expect(response.status).toBe(200);
    const body = await response.json<{
      status: string;
      db: string;
      invitation_key: string;
      server_time: number;
    }>();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.invitation_key).toBe("ok");
    // The client measures this against its own clock to sign requests even
    // when the computer's clock is hours out.
    expect(Math.abs(body.server_time - Date.now() / 1000)).toBeLessThan(5);
  });

  it("has the D1 binding and the migrated schema", async () => {
    const tables = await testBindings.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all();
    const names = (tables.results as Array<{ name: string }>).map((row) => row.name);
    expect(names).toContain("devices");
    expect(names).toContain("signal_codes");
  });
});
