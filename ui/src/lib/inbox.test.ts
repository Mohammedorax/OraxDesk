import { describe, expect, it } from "vitest";
import {
  inboxStateLook,
  isMissingRegistryError,
  normalizeInboxNumber,
  withoutRemoved,
} from "./inbox";
import type { InboxEntry } from "./types";

function entry(id: string, number: string): InboxEntry {
  return {
    id,
    number,
    note: null,
    deviceId: null,
    state: "unknown",
    detail: null,
    lastCheckedAt: null,
    createdAt: 0,
  };
}

describe("normalizeInboxNumber", () => {
  it("takes nine digits as they are", () => {
    expect(normalizeInboxNumber("250739098")).toBe("250739098");
  });

  it("ignores the spaces and dashes a number is read out with", () => {
    // A number arrives over the phone with a space in it, and a person who
    // writes it down may write a dash. Neither is a different number.
    expect(normalizeInboxNumber("250 739 098")).toBe("250739098");
    expect(normalizeInboxNumber("250-739-098")).toBe("250739098");
    expect(normalizeInboxNumber("  250739098  ")).toBe("250739098");
  });

  it("refuses anything that is not nine digits", () => {
    // Eight digits, ten digits, letters, an empty box: none of them is a
    // device number, and a row that holds one is a row nobody can dial.
    expect(normalizeInboxNumber("25073909")).toBeNull();
    expect(normalizeInboxNumber("2507390981")).toBeNull();
    expect(normalizeInboxNumber("25073909a")).toBeNull();
    expect(normalizeInboxNumber("a25073909")).toBeNull();
    expect(normalizeInboxNumber("")).toBeNull();
    expect(normalizeInboxNumber("   ")).toBeNull();
  });

  it("refuses a machine id, which is a different kind of name", () => {
    // 64 hex characters is the full device id. It is not a number and the
    // registry does not look it up as one.
    expect(normalizeInboxNumber("a".repeat(64))).toBeNull();
  });
});

describe("inboxStateLook", () => {
  it("names every state the backend can write", () => {
    expect(inboxStateLook("unknown").labelKey).toBe("inbox.state.unknown");
    expect(inboxStateLook("reachable").labelKey).toBe("inbox.state.reachable");
    expect(inboxStateLook("no-address").labelKey).toBe("inbox.state.noAddress");
    expect(inboxStateLook("revoked").labelKey).toBe("inbox.state.revoked");
    expect(inboxStateLook("error").labelKey).toBe("inbox.state.error");
  });

  it("draws an unchecked number as nothing but unchecked", () => {
    // THE truthfulness rule. A number nobody has asked about is NOT an
    // offline machine, so it must not be drawn like one: it is muted, and it
    // says it has not been asked yet.
    const look = inboxStateLook("unknown");
    expect(look.tone).toBe("muted");
    expect(look.detailKey).toBe("inbox.detail.unknown");
  });

  it("draws a machine that published no address as a warning, not as a failure", () => {
    // The fix is on the other machine, not here, so this is a warning.
    expect(inboxStateLook("no-address").tone).toBe("warn");
  });

  it("reads a state it has never seen as unchecked", () => {
    // A row written by a newer build still has a number in it and can still
    // be dialled. It must not look like a broken list.
    expect(inboxStateLook("sleeping").labelKey).toBe("inbox.state.unknown");
    expect(inboxStateLook("").labelKey).toBe("inbox.state.unknown");
  });
});

describe("isMissingRegistryError", () => {
  it("tells an unset registry from a registry that refused", () => {
    // Two different problems with two different fixes, and the operator has
    // to be told which one they are looking at.
    expect(isMissingRegistryError(new Error("no registry origin has been set"))).toBe(true);
    expect(isMissingRegistryError("no registry origin has been set")).toBe(true);
    expect(isMissingRegistryError(new Error("The registry could not be asked: timeout"))).toBe(false);
    expect(isMissingRegistryError(new Error("not found"))).toBe(false);
  });
});

describe("withoutRemoved", () => {
  const LIST = [entry("a", "250739098"), entry("b", "250739099")];

  it("keeps a number that has not been removed", () => {
    expect(withoutRemoved(LIST, new Set()).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("drops a number that has been removed", () => {
    expect(withoutRemoved(LIST, new Set(["a"])).map((row) => row.id)).toEqual(["b"]);
  });

  it("keeps a removed number out even when a refresh brings it back", () => {
    // The remove and the refresh are two separate requests, and the answer
    // that arrives last is not necessarily the newer truth: a row that comes
    // back on its own is a row nobody deleted.
    expect(withoutRemoved(LIST, new Set(["a"])).map((row) => row.id)).not.toContain("a");
  });

  it("does not touch the list it was given", () => {
    const list = [entry("a", "250739098")];
    withoutRemoved(list, new Set(["a"]));
    expect(list).toHaveLength(1);
  });
});
