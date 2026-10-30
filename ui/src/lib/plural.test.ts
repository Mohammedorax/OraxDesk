import { describe, expect, it } from "vitest";
import { pluralForm, pluralKey } from "./plural";

/**
 * The plural rules are the whole point of the module, so they are checked
 * against the categories CLDR defines rather than against strings: a test
 * that asserted on a sentence would keep passing after the wrong form was
 * wired to the right category.
 */
describe("pluralForm", () => {
  it("gives Arabic its six categories", () => {
    expect(pluralForm("ar", 0)).toBe("zero");
    expect(pluralForm("ar", 1)).toBe("one");
    expect(pluralForm("ar", 2)).toBe("two");
    expect(pluralForm("ar", 3)).toBe("few");
    expect(pluralForm("ar", 11)).toBe("many");
    expect(pluralForm("ar", 100)).toBe("other");
  });

  it("gives English only the two categories it has", () => {
    expect(pluralForm("en", 1)).toBe("one");
    for (const count of [0, 2, 3, 11, 100]) {
      expect(pluralForm("en", count), `english: ${count}`).toBe("other");
    }
  });

  it("reads a negative count by its magnitude", () => {
    // CLDR plural rules use the absolute value: "لا شيء" is zero whether the
    // caller arrived with 0 or -0, and -1 is still one host.
    expect(pluralForm("en", -1)).toBe("one");
    expect(pluralForm("ar", -3)).toBe("few");
  });

  it("gives a fraction the other category", () => {
    // A count of 1.5 is not one host, and neither language has a form for
    // half a host; `other` is the only honest answer.
    expect(pluralForm("en", 1.5)).toBe("other");
    expect(pluralForm("ar", 1.5)).toBe("other");
  });

  it("keeps a locale with one category on other", () => {
    // Japanese makes no singular/plural distinction at all, which is the
    // case that would break a hand written one/other rule.
    expect(pluralForm("ja", 0)).toBe("other");
    expect(pluralForm("ja", 1)).toBe("other");
    expect(pluralForm("ja", 2)).toBe("other");
  });

  it("never throws on a count that is not a number", () => {
    expect(pluralForm("en", Number.NaN)).toBe("other");
    expect(pluralForm("ar", Number.POSITIVE_INFINITY)).toBe("other");
  });

  it("answers in English rather than throwing on a malformed locale", () => {
    expect(pluralForm("not a locale", 1)).toBe("one");
    expect(pluralForm("not a locale", 2)).toBe("other");
  });
});

describe("pluralKey", () => {
  it("asks for the category the language actually uses", () => {
    expect(pluralKey("library.selectedCount", "ar", 2)).toBe(
      "library.selectedCount.two",
    );
    expect(pluralKey("library.selectedCount", "ar", 3)).toBe(
      "library.selectedCount.few",
    );
    // English has no dual, so it must not ask for `.two` even at a count of 2.
    expect(pluralKey("library.selectedCount", "en", 2)).toBe(
      "library.selectedCount.other",
    );
    expect(pluralKey("library.selectedCount", "en", 1)).toBe(
      "library.selectedCount.one",
    );
  });

  it("keeps a dotted base intact", () => {
    // The suffix is appended, never parsed out of the base: a key like
    // `files.deleteConfirm` must not lose its last segment.
    expect(pluralKey("files.deleteConfirm", "ar", 0)).toBe(
      "files.deleteConfirm.zero",
    );
  });
});
