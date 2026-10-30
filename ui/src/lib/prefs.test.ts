import { beforeEach, describe, expect, it } from "vitest";
import {
  PREF_HIDE_TOOLBAR,
  prefStorageKey,
  readToolbarHidden,
  writeBoolPref,
} from "./prefs";

/**
 * The session toolbar is the only place most people ever touch scaling,
 * quality, displays and the clipboard, and it is drawn by the session view
 * only when this answer is false. So these are the two failures that matter:
 * an install that had it switched off must come back visible, and a person
 * who switches it off now must keep that answer.
 */
describe("readToolbarHidden", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the toolbar on a machine that has never been configured", () => {
    expect(readToolbarHidden()).toBe(false);
  });

  it("repairs an install that stored the toolbar as gone", () => {
    // The old switch removed the bar from the tree, and with it every control
    // that could bring it back from inside the session. Honouring this stored
    // value is exactly what leaves someone with no toolbar at all.
    localStorage.setItem(prefStorageKey(PREF_HIDE_TOOLBAR), "1");
    expect(readToolbarHidden()).toBe(false);
    expect(localStorage.getItem(prefStorageKey(PREF_HIDE_TOOLBAR))).toBe("0");
  });

  it("repairs only once, so the next deliberate hide sticks", () => {
    localStorage.setItem(prefStorageKey(PREF_HIDE_TOOLBAR), "1");
    expect(readToolbarHidden()).toBe(false);
    // The user hides it again, with the toggle the bar now carries.
    writeBoolPref(PREF_HIDE_TOOLBAR, true);
    expect(readToolbarHidden()).toBe(true);
    // And it is still hidden after a restart, rather than being repaired again.
    expect(readToolbarHidden()).toBe(true);
  });

  it("keeps a stored 'shown' answer without rewriting it", () => {
    localStorage.setItem(prefStorageKey(PREF_HIDE_TOOLBAR), "0");
    expect(readToolbarHidden()).toBe(false);
    expect(localStorage.getItem(prefStorageKey(PREF_HIDE_TOOLBAR))).toBe("0");
  });
});
