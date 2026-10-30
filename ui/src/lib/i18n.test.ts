import { describe, expect, it } from "vitest";
import { planeStatusDetail, planeStatusLine, type PlaneView } from "./agentActivity";
import { MESSAGE_KEYS, translatorFor } from "./i18n";

/**
 * The catalogue is the one thing in the app that is written twice, and a key
 * that is present in one language and missing in the other shows up as the
 * key's own name on the screen. "wall.sent" in the middle of a card is worse
 * than no label at all, because it looks like a word.
 *
 * The types catch a missing ENGLISH key at compile time, because English is
 * typed as `Record<keyof typeof ar, string>`. Nothing catches a missing
 * ARABIC key, because the Arabic table is the source of truth and the
 * English table is the copy. So the checks here are the other way round, and
 * they are runtime checks on purpose.
 */
describe("the message catalogue", () => {
  const ar = translatorFor("ar");
  const en = translatorFor("en");

  it("never shows a key's own name in either language", () => {
    // Every key, resolved in both languages, must be a sentence and not the
    // key. `t` falls back to the key when a language is missing it, so this
    // is the check that catches a half translated catalogue.
    for (const key of MESSAGE_KEYS) {
      expect(ar(key), `arabic: ${key}`).not.toBe(key);
      expect(en(key), `english: ${key}`).not.toBe(key);
    }
  });

  it("keeps every string non empty in both languages", () => {
    for (const key of MESSAGE_KEYS) {
      expect(ar(key).trim().length, `arabic: ${key}`).toBeGreaterThan(0);
      expect(en(key).trim().length, `english: ${key}`).toBeGreaterThan(0);
    }
  });

  it("substitutes every placeholder it is given", () => {
    // A template that still holds a `{name}` after substitution is a broken
    // sentence, and it is invisible unless something checks for it.
    const line = ar("wall.planeIdleMany", { agents: 4 });
    expect(line).not.toContain("{");
    expect(line).toContain("4");
  });

  it("resolves a plural base with the language's own rules", () => {
    // The catalogue keys are flat (`library.hostsCount.two`), but a caller
    // names only the base and the count. The count is substituted too, so the
    // sentence does not have to repeat it in the replacement map.
    expect(ar.plural("library.hostsCount", 1)).toBe("مضيف واحد");
    expect(ar.plural("library.hostsCount", 2)).toBe("مضيفان");
    expect(ar.plural("library.hostsCount", 3)).toBe("3 مضيفين");
    expect(en.plural("library.hostsCount", 1)).toBe("1 host");
    expect(en.plural("library.hostsCount", 2)).toBe("2 hosts");
  });

  it("says the plane's line in Arabic, not in English", () => {
    const plane: PlaneView = {
      on: true,
      agents: 2,
      driving: 3,
      sessions: 5,
      socket: "/tmp/s",
      error: null,
      binary: null,
      httpUrl: null,
    };
    expect(ar("wall.planeIdleOne")).not.toBe("wall.planeIdleOne");
    expect(planeStatusLine(plane, ar)).toContain("وكلاء");
    expect(planeStatusDetail(plane, ar)).toContain("الإيجار");
  });

  it("keeps the agent wall's own keys in the catalogue", () => {
    // The wall is the surface a person sees when an agent is driving their
    // computers, so a missing key here is a missing label on the one part of
    // the app that has to be read at a glance.
    for (const key of [
      "wall.idle",
      "wall.stopAll",
      "wall.stopAllTitle",
      "wall.stopAllAskOne",
      "wall.stopAllAskMany",
      "wall.stopAllConfirm",
      "wall.cancel",
      "wall.explain",
      "wall.explainHide",
      "wall.stopAllDialog",
      "wall.yoursNow",
      "wall.tookWheel",
      "wall.doing",
      "wall.sent",
      "wall.refused",
      "wall.failed",
      "wall.unread",
      "wall.title",
    ] as const) {
      expect(MESSAGE_KEYS, `missing from the catalogue: ${key}`).toContain(key);
    }
  });
});
