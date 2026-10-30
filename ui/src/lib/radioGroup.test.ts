import { describe, expect, it } from "vitest";
import { radioMove } from "./radioGroup";

describe("radioMove", () => {
  it("walks forward and backward with Up and Down", () => {
    expect(radioMove("ArrowDown", 0, 3, "ltr")).toBe(1);
    expect(radioMove("ArrowDown", 2, 3, "ltr")).toBe(0);
    expect(radioMove("ArrowUp", 0, 3, "ltr")).toBe(2);
  });

  it("walks with the reading direction, not the physical one", () => {
    // In Arabic the next option sits to the left, so ArrowLeft moves forward.
    expect(radioMove("ArrowRight", 1, 3, "rtl")).toBe(0);
    expect(radioMove("ArrowLeft", 1, 3, "rtl")).toBe(2);
    expect(radioMove("ArrowRight", 1, 3, "ltr")).toBe(2);
    expect(radioMove("ArrowLeft", 1, 3, "ltr")).toBe(0);
  });

  it("ignores keys a radio group does not own", () => {
    expect(radioMove("Enter", 0, 3, "ltr")).toBeNull();
    expect(radioMove("Tab", 0, 3, "ltr")).toBeNull();
  });

  it("has nothing to move to in an empty group", () => {
    expect(radioMove("ArrowDown", 0, 0, "ltr")).toBeNull();
  });
});
