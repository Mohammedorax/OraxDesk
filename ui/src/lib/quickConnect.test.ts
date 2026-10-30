import { describe, expect, it } from "vitest";
import { enterAction, modeToggle } from "./quickConnect";

describe("enterAction", () => {
  it("dials anything typed in connect mode", () => {
    // Connect mode exists so Enter means "this address, now" without the
    // person having to reach for the button.
    expect(enterAction("connect", "192.168.1.20:1", false)).toBe("connect");
    expect(enterAction("connect", "frontdesk", false)).toBe("connect");
    // Even text that will fail to parse: the field answers with its own
    // error, and silence would be the worse failure.
    expect(enterAction("connect", "???", false)).toBe("connect");
  });

  it("dials in search mode only a saved host's exact address", () => {
    // Search mode is the Library's box: Enter dials only the one case that
    // is unambiguous "yes, that machine", and otherwise stays out of the
    // way of the results.
    expect(enterAction("search", "frontdesk", true)).toBe("connect");
    expect(enterAction("search", "front", false)).toBe("ignore");
    expect(enterAction("search", "front", true)).toBe("connect");
  });

  it("never dials an empty or whitespace field", () => {
    expect(enterAction("connect", "", false)).toBe("ignore");
    expect(enterAction("connect", "   ", false)).toBe("ignore");
    expect(enterAction("search", "   ", true)).toBe("ignore");
  });
});

describe("modeToggle", () => {
  it("pressed describes the CURRENT mode, not the one it switches to", () => {
    // aria-pressed is the state of the thing the button is named for, so it
    // is true exactly while connect mode is on.
    expect(modeToggle("search").pressed).toBe(false);
    expect(modeToggle("connect").pressed).toBe(true);
  });

  it("hints what clicking does, which is the opposite of the current mode", () => {
    expect(modeToggle("search").hintKey).toBe("quick.switchToConnect");
    expect(modeToggle("connect").hintKey).toBe("quick.switchToSearch");
  });
});
