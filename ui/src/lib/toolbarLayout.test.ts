import { describe, expect, it } from "vitest";
import {
  TOOLBAR_COLLAPSE_ORDER,
  TOOLBAR_GROUPS,
  TOOLBAR_MENU_GROUPS,
  collapseToolbarGroups,
  type ToolbarGroupId,
} from "./toolbarLayout";

/**
 * The rule that decides which of the session toolbar's groups fold away when
 * the pane is too narrow. The widths below are one bar's worth of real
 * measurements, rounded: the numbers only have to be in the right ratio to
 * each other for the order of folding to be observable.
 */
function measuredWidths(): Partial<Record<ToolbarGroupId, number>> {
  return {
    quick: 100, // grip + fullscreen + Ctrl+Alt+Del
    status: 68, // the latency readout
    view: 144, // scaling, displays, pointers
    tuning: 104, // quality + keyboard
    transfer: 96, // clipboard, files, terminal
    pane: 132, // splits, view-only, screenshot, refresh
    chrome: 72, // pin + put-away
    disconnect: 32,
  };
}

/** Everything in `measuredWidths`, plus the gap charged after each group. */
function fullBarWidth(): number {
  return Object.values(measuredWidths()).reduce((sum, w) => sum + (w ?? 0), 0) + TOOLBAR_GROUPS.length * 4;
}

/** The weakest `n` groups, which is all a fold ever removes. */
function prefix(n: number): Set<ToolbarGroupId> {
  return new Set(TOOLBAR_COLLAPSE_ORDER.slice(0, n));
}

describe("which toolbar groups fold", () => {
  it("folds nothing while the bar fits", () => {
    expect(collapseToolbarGroups(measuredWidths(), fullBarWidth())).toEqual(new Set());
    expect(collapseToolbarGroups(measuredWidths(), fullBarWidth() + 400)).toEqual(new Set());
  });

  it("folds only the weakest group when one group's width buys the room", () => {
    // One pane-group fold leaves 740px of bar, overflow control included.
    const room = fullBarWidth() - 40;
    expect(collapseToolbarGroups(measuredWidths(), room)).toEqual(prefix(1));
  });

  /**
   * The overflow control is part of the budget from the first fold: at this
   * width one fold would be enough if the control were free (644px of bar),
   * and is not once its own width is charged (740px), so a second group has
   * to fold. The assertion only holds because the control's width is counted.
   */
  it("charges the overflow control from the first group folded", () => {
    expect(collapseToolbarGroups(measuredWidths(), 700)).toEqual(prefix(2));
  });

  /**
   * The promise the component leans on: whatever the width, the folded set
   * is a prefix of the declared order. Nothing newer ever folds while
   * something older is still on the bar.
   */
  it("folds strictly weakest-first, at every width", () => {
    for (let room = 0; room <= fullBarWidth(); room += 7) {
      const folded = collapseToolbarGroups(measuredWidths(), room);
      expect([...folded]).toEqual(TOOLBAR_COLLAPSE_ORDER.slice(0, folded.size));
    }
  });

  it("never folds the controls that have to stay", () => {
    const folded = collapseToolbarGroups(measuredWidths(), 0);
    expect(folded).toEqual(prefix(TOOLBAR_COLLAPSE_ORDER.length));
    for (const id of ["quick", "tuning", "disconnect"] as const) {
      expect(folded.has(id)).toBe(false);
    }
  });

  /**
   * A group's width arrives only after it has rendered once. Until then it
   * reports nothing, and reporting nothing must not make the rule fold it:
   * a first pass that hid buttons nobody had seen would be a bar that
   * shrinks unbidden on every fresh pane.
   */
  it("leaves a group it has never measured alone", () => {
    const widths = measuredWidths();
    delete widths.pane;
    // More bar than room, and still the pane group is not folded: it has no
    // width, so folding it would give nothing back.
    const folded = collapseToolbarGroups(widths, 500);
    expect(folded.has("pane")).toBe(false);
    expect(folded.has("transfer")).toBe(true);
    expect(folded.has("view")).toBe(true);
  });

  it("treats a width that is not a positive number as no width at all", () => {
    const widths: Partial<Record<ToolbarGroupId, number>> = {
      ...measuredWidths(),
      pane: Number.NaN,
      transfer: -5,
    };
    const folded = collapseToolbarGroups(widths, 100);
    expect(folded.has("pane")).toBe(false);
    expect(folded.has("transfer")).toBe(false);
    expect(folded.has("view")).toBe(true);
    expect(folded.has("status")).toBe(true);
    expect(folded.has("chrome")).toBe(true);
  });

  it("names every foldable group as a real group of the bar", () => {
    for (const id of TOOLBAR_COLLAPSE_ORDER) {
      expect(TOOLBAR_GROUPS).toContain(id);
    }
    // The menu-backed groups are the front of the collapse order, so the
    // overflow control always exists by the time a group without an entry
    // (status, chrome) goes away.
    for (const id of TOOLBAR_MENU_GROUPS) {
      expect(TOOLBAR_COLLAPSE_ORDER).toContain(id);
      expect(TOOLBAR_COLLAPSE_ORDER.indexOf(id)).toBeLessThan(3);
    }
  });
});
