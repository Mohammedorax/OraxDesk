/**
 * The two decisions the QuickConnect field's mode is allowed to make, as pure
 * functions.
 *
 * The header field is also the Library's search box. Typing is NOT one of the
 * mode's decisions: every keystroke filters the Library in both modes,
 * because a filter that silently switches off with a toggle is a trap whose
 * only cure is noticing and toggling back. So the mode decides exactly two
 * things — what ENTER dials, and what the toggle button says about itself —
 * and both answers live here so the component cannot wire one truth and
 * render another: the same values feed the key handler and `aria-pressed`,
 * which by the toggle-button pattern must describe what IS true, not what
 * pressing would do.
 */
import type { MessageKey } from "./i18n";

export type QuickMode = "search" | "connect";

/**
 * What Enter does with what is typed.
 *
 * In connect mode Enter always dials: the text is meant as an endpoint, and
 * an unparseable one is answered by the field's own error message, not by
 * silence. In search mode Enter dials ONLY when the text is the address of a
 * saved host — an exact "yes, that machine" — because the rest of the time
 * the search results are the affordance and Enter belongs to the Library.
 * An empty field never dials.
 */
export function enterAction(
  mode: QuickMode,
  typed: string,
  hasSavedMatch: boolean,
): "connect" | "ignore" {
  if (typed.trim() === "") return "ignore";
  return mode === "connect" || hasSavedMatch ? "connect" : "ignore";
}

/**
 * What the mode toggle reports about itself.
 *
 * The button is named for the thing it toggles — connect mode — so `pressed`
 * is true exactly when connect mode IS on. `hintKey` names what CLICKING
 * does, and is only the hover tooltip. The previous version showed the mode
 * you would switch TO as the visible label while `aria-pressed` described
 * the mode you were IN, so a screen reader heard a name and a state about
 * two different modes.
 */
export function modeToggle(mode: QuickMode): { pressed: boolean; hintKey: MessageKey } {
  return {
    pressed: mode === "connect",
    hintKey: mode === "search" ? "quick.switchToConnect" : "quick.switchToSearch",
  };
}
