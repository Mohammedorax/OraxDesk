import { describe, expect, it } from "vitest";
import { deleteSelection } from "./hostDeletion";
import { blankHostProfile, type HostProfile } from "./types";

function host(id: string, friendlyName: string): HostProfile {
  return { ...blankHostProfile(), id, friendlyName };
}

const LIBRARY: HostProfile[] = [
  host("a", "Studio"),
  host("b", "Laptop"),
  host("c", "Reception"),
];

describe("deleteSelection", () => {
  it("aims at the machine the person selected", () => {
    const selection = deleteSelection(LIBRARY, new Set(["b"]));
    expect(selection.blocked).toBeNull();
    expect(selection.targets.map((h) => h.id)).toEqual(["b"]);
  });

  it("aims at every selected machine", () => {
    const selection = deleteSelection(LIBRARY, new Set(["a", "c"]));
    expect(selection.blocked).toBeNull();
    expect(selection.targets.map((h) => h.id)).toEqual(["a", "c"]);
  });

  it("keeps the library's order rather than the selection's", () => {
    // The names in the confirmation should read the way the tiles do, not the
    // way the ids happen to be typed.
    const selection = deleteSelection(LIBRARY, ["c", "a"]);
    expect(selection.targets.map((h) => h.id)).toEqual(["a", "c"]);
  });

  it("is blocked when nothing is selected", () => {
    // The button stays on screen and says why it cannot act, rather than
    // disappearing: a control that vanishes is a control nobody can find.
    const selection = deleteSelection(LIBRARY, new Set<string>());
    expect(selection.blocked).toBe("empty");
    expect(selection.targets).toEqual([]);
  });

  it("drops an id whose machine is no longer in the library", () => {
    // A host deleted in another window leaves its id behind. A delete aimed at
    // it would ask the backend about a machine that is not there.
    const selection = deleteSelection(LIBRARY, new Set(["gone"]));
    expect(selection.blocked).toBe("empty");
    expect(selection.targets).toEqual([]);
  });

  it("keeps the machines that are still there when one id has gone stale", () => {
    const selection = deleteSelection(LIBRARY, new Set(["gone", "a"]));
    expect(selection.blocked).toBeNull();
    expect(selection.targets.map((h) => h.id)).toEqual(["a"]);
  });
});
