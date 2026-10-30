import { describe, expect, it } from "vitest";
import { DEVICE_STATUSES, DEVICE_TONE_CLASS, deviceStatusLook } from "./deviceStatus";
import { translatorFor } from "./i18n";

/**
 * The identity card is one of the few places the app makes a claim about a
 * machine it has not connected to, so the claim is held to three rules: every
 * state has a colour and a sentence in both languages, the colours mean what
 * the operator's own inbox means by them, and no state ever says presence.
 */
describe("the identity card's status", () => {
  const ar = translatorFor("ar");
  const en = translatorFor("en");

  it("gives every state a colour and a sentence in both languages", () => {
    for (const status of DEVICE_STATUSES) {
      const look = deviceStatusLook(status);
      expect(DEVICE_TONE_CLASS[look.tone], status).toBeTruthy();
      expect(ar(look.labelKey), `arabic: ${status}`).not.toBe(look.labelKey);
      expect(en(look.labelKey), `english: ${status}`).not.toBe(look.labelKey);
    }
  });

  it("colours each state the way the inbox colours the same answer", () => {
    expect(deviceStatusLook("published").tone).toBe("good");
    expect(deviceStatusLook("no-address").tone).toBe("warn");
    expect(deviceStatusLook("not-registered").tone).toBe("warn");
    expect(deviceStatusLook("revoked").tone).toBe("bad");
    expect(deviceStatusLook("unchecked").tone).toBe("muted");
    expect(deviceStatusLook("unknown").tone).toBe("muted");
  });

  it("never claims presence it does not have", () => {
    // This build has no presence signal for a machine it has not connected to
    // (see docs/CUSTOMER-SETUP.md), so "online" and "offline" would both be
    // guesses dressed up as facts.
    for (const status of DEVICE_STATUSES) {
      expect(en(deviceStatusLook(status).labelKey).toLowerCase()).not.toMatch(/online|offline/);
    }
  });
});
