import { describe, expect, it } from "vitest";
import { trimToastStack } from "./toastStack";

const info = (id: number) => ({ id, message: `info ${id}`, actionLabel: undefined });
const undo = (id: number) => ({ id, message: `undo ${id}`, actionLabel: "Undo" });

describe("trimToastStack", () => {
  it("leaves a stack at or under the cap alone", () => {
    const stack = [info(1), undo(2)];
    expect(trimToastStack(stack, 3)).toEqual(stack);
  });

  it("drops the oldest plain toast first", () => {
    const trimmed = trimToastStack([info(1), info(2), undo(3), info(4)], 3);
    expect(trimmed.map((t) => t.id)).toEqual([2, 3, 4]);
  });

  it("never evicts a toast carrying the only Undo", () => {
    // Three newer toasts arrive over the confirmation. The Undo is older than
    // all of them and is still the point of the shelf.
    const trimmed = trimToastStack([undo(1), info(2), info(3), info(4)], 3);
    expect(trimmed.map((t) => t.id)).toEqual([1, 3, 4]);
  });

  it("still respects the cap when every toast has an action", () => {
    const trimmed = trimToastStack([undo(1), undo(2), undo(3), undo(4)], 3);
    expect(trimmed.map((t) => t.id)).toEqual([2, 3, 4]);
  });
});
