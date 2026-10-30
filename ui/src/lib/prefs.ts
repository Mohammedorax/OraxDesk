/**
 * Webview-local preferences (`localStorage`), shared between the Preferences
 * screen that writes them and the code that acts on them.
 *
 * These are deliberately NOT the Rust-store settings in `useAppSetting`: those
 * exist because the backend has to consult them while building a connection.
 * Everything here is decided in the webview.
 *
 * Readers call [`readBoolPref`] at the moment they need the value rather than
 * holding it in React state. Preferences is its own window, so a cached copy
 * would need a cross-window change notification to stay honest; reading on use
 * means a toggle applies to the very next action with no plumbing at all.
 */

const PREFIX = "deskvnc.pref.";

/** Send the local clipboard to the remote automatically (master switch). */
export const PREF_CLIPBOARD_AUTO = "clipboardAuto";
/** Push the local clipboard when the session window regains focus. */
export const PREF_CLIPBOARD_ON_FOCUS = "clipboardOnFocus";
/**
 * Scroll the remote desktop the way this computer scrolls. On by default: the
 * wheel delta the webview reports has already been through the OS, so passing
 * it straight to the remote is what makes the gesture agree with every local
 * window. Off reverses it, for anyone who wants the remote to go the other way.
 */
export const PREF_NATURAL_SCROLL = "naturalScroll";
/**
 * Keys type what they type on THIS keyboard's layout, rather than what the
 * remote machine's layout assigns to the same physical key. Off by default:
 * scancode mode is what makes remote shortcuts and games behave, and the two
 * only disagree when the machines' layouts differ.
 */
export const PREF_MATCH_LOCAL_LAYOUT = "matchLocalKeyboardLayout";
/**
 * Type text that dictation and automation tools insert (rather than press
 * keys for) into the remote desktop. Dead keys and CJK input methods are NOT
 * behind this switch: those are the user physically typing.
 */
export const PREF_FORWARD_INSERTED_TEXT = "forwardInsertedText";
/**
 * Type the clipboard on the remote when a paste happens locally in a session:
 * a Cmd+V that pass-through leaves to macOS, or Edit ▸ Paste. This is how
 * dictation tools that paste (Wispr Flow) reach the remote desktop. Off, the
 * paste is cancelled and nothing is sent.
 */
export const PREF_TYPE_LOCAL_PASTE = "typeLocalPaste";
/**
 * Push the local clipboard to the remote right before a forwarded paste
 * chord, so Cmd/Ctrl+V pastes what the clipboard holds at that moment.
 */
export const PREF_CLIPBOARD_ON_PASTE = "clipboardOnPaste";
/**
 * Ignore pinch-to-zoom in a session. The gesture is easy to trigger by
 * accident mid-scroll on a trackpad, and rescaling the view is rarely what
 * was meant; the toolbar's zoom controls still work while it is on.
 */
export const PREF_ZOOM_LOCKED = "zoomLocked";
/**
 * Scroll the view when the pointer reaches an edge, for a desktop larger
 * than the window. On by default, because without it the part of the screen
 * past the edge cannot be reached at all; off for anyone who finds the view
 * moving under them distracting. Space-drag panning works either way.
 */
export const PREF_EDGE_PAN = "edgePan";
/**
 * Start the session view with the floating toolbar put away.
 *
 * Put away means the bar is folded to its chevron, not gone: the chevron is
 * the way back, and so is the show/hide chord. That distinction is the whole
 * point of the setting — an earlier build took the bar away completely, and
 * with it went every control that could bring it back from inside the
 * session, which is how a person ends up with a session that has no toolbar
 * and no way to find one. Off by default.
 */
export const PREF_HIDE_TOOLBAR = "hideToolbar";

/**
 * Marker for the one-time repair of that older "gone completely" state.
 *
 * Kept apart from {@link PREF_HIDE_TOOLBAR} because writing that value is also
 * how a person hides the bar now: a repair that keyed off "the value is 1"
 * would undo the choice every single session.
 */
const PREF_TOOLBAR_REPAIRED = "toolbarVisibilityRepaired";

/**
 * Is the session toolbar put away?
 *
 * Every read goes through here rather than through [`readBoolPref`] so the
 * repair below cannot be missed by one call site out of four: the session
 * view, the library shell, the native menu and the Preferences switch all ask
 * the same question and all have to give the same answer.
 *
 * The repair itself runs once per install, on the first read. Installs that
 * arrived from the build that removed the bar outright stored "hidden", and
 * honouring that stored answer is exactly what leaves them with no toolbar:
 * the menu item that shows it again was disabled while it was hidden and the
 * chord went with it. So that stored answer is discarded once, and from then
 * on the switch the user now has on the bar itself is the last word — it is
 * written straight back to the same key.
 */
export function readToolbarHidden(): boolean {
  try {
    if (localStorage.getItem(prefStorageKey(PREF_TOOLBAR_REPAIRED)) === null) {
      // Written straight to storage rather than through `writeBoolPref`: this
      // runs while the session view is building its first state, and a change
      // event dispatched from inside a render is a state update in someone
      // else's render. Nothing is listening for this key that has to hear it
      // here; every reader calls this function.
      localStorage.setItem(prefStorageKey(PREF_HIDE_TOOLBAR), "0");
      localStorage.setItem(prefStorageKey(PREF_TOOLBAR_REPAIRED), "1");
    }
  } catch {
    /* storage unavailable: there is nothing stored to repair either way */
  }
  return readBoolPref(PREF_HIDE_TOOLBAR, false);
}

/**
 * Take the agent counts out of the activity strip.
 *
 * Off by default, so the counts show wherever there is a plane to count: a
 * number of remote machines being driven by something other than the person
 * watching is not a thing to make somebody go looking for. With the plane
 * switched off there is no strip and this preference decides nothing.
 *
 * The strip is not the only way back: this switch lives in Preferences, which
 * is where it stays reachable after the counts are gone.
 */
export const PREF_HIDE_AGENT_STATUS = "hideAgentStatus";

/**
 * Whether the agent wall has already explained itself.
 *
 * The wall appears out of nowhere the moment an agent holds a lease, and it is
 * the only surface in the app that talks about agents. A person who has not
 * asked for one has no idea what they are looking at, so it says what it is
 * once. The flag is here so that "once" survives a restart.
 */
export const PREF_AGENT_WALL_EXPLAINED = "agentWallExplained";

/**
 * Fired on `window` when a boolean preference is written in THIS window.
 *
 * Preferences and the shell chrome share a window here, so a switch flipped in
 * one has to reach the other without a reload. Readers that want to follow a
 * preference live listen for this and re-read; readers that only need the
 * value at the moment they act, which is most of them, carry on calling
 * [`readBoolPref`] and ignore it entirely. `detail` carries the key so a
 * listener can drop the events that are not about it.
 */
export const PREF_CHANGED_EVENT = "deskvnc://pref-changed";

export interface PrefChanged {
  key: string;
  value: boolean;
}

export function prefStorageKey(key: string): string {
  return `${PREFIX}${key}`;
}

/**
 * Read a boolean preference, falling back to `fallback` when it has never been
 * set (or when storage is unavailable, as in a locked-down webview).
 */
export function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(prefStorageKey(key));
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function writeBoolPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(prefStorageKey(key), value ? "1" : "0");
  } catch {
    /* storage unavailable; the preference simply does not persist */
  }
  // Outside the try above on purpose: a webview that refuses storage still has
  // the value for as long as this window lives, and a listener that acts on it
  // should get the same answer either way.
  try {
    window.dispatchEvent(
      new CustomEvent<PrefChanged>(PREF_CHANGED_EVENT, { detail: { key, value } }),
    );
  } catch {
    /* no DOM (a unit test); nothing is listening in that case either */
  }
}
