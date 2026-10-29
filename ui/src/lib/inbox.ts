/**
 * The support inbox: the numbers clients send, and what the registry said.
 *
 * The WORDS live in the catalogue and the DECISIONS live here, so the two
 * things that must not drift apart — what a state means and what it is
 * called — are in one place a test can hold.
 */
import type { MessageKey } from "./i18n";
import { isInboxState, type InboxEntry, type InboxState } from "./types";

/**
 * The catalogue keys this module owns.
 *
 * A key that is not in the catalogue is a compile error here rather than a
 * sentence that reads as the key's own name on somebody's screen.
 */
export type InboxKey = Extract<MessageKey, `inbox.${string}`>;

/** How a chip is coloured. */
export type InboxTone = "muted" | "good" | "warn" | "bad";

/** What a state is called, what it means, and how it is drawn. */
export interface InboxStateLook {
  /** The chip's own words. */
  labelKey: InboxKey;
  /** The line that says what the state means. */
  detailKey: InboxKey;
  /** The tone the chip is drawn in. */
  tone: InboxTone;
}

const LOOKS: Record<InboxState, InboxStateLook> = {
  unknown: {
    labelKey: "inbox.state.unknown",
    detailKey: "inbox.detail.unknown",
    tone: "muted",
  },
  reachable: {
    labelKey: "inbox.state.reachable",
    detailKey: "inbox.detail.reachable",
    tone: "good",
  },
  "no-address": {
    labelKey: "inbox.state.noAddress",
    detailKey: "inbox.detail.noAddress",
    tone: "warn",
  },
  revoked: {
    labelKey: "inbox.state.revoked",
    detailKey: "inbox.detail.revoked",
    tone: "bad",
  },
  error: {
    labelKey: "inbox.state.error",
    detailKey: "inbox.detail.error",
    tone: "bad",
  },
};

/**
 * The look of a state.
 *
 * A state a newer build wrote is shown as "not asked yet" rather than as
 * nothing at all: the number is still in the list and still connectable, and
 * a chip that says nothing is a chip that says the list is broken.
 */
export function inboxStateLook(state: string): InboxStateLook {
  return LOOKS[isInboxState(state) ? state : "unknown"];
}

/**
 * The nine digits of a device number, or null when the text is not one.
 *
 * Spaces and dashes are ignored, because a number read out over the phone
 * arrives with them. Everything else is refused: a device number is nine
 * digits and nothing else, and a row holding anything else is a row nobody
 * can dial.
 */
export function normalizeInboxNumber(text: string): string | null {
  const digits = text.trim().replace(/[\s-]/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

/**
 * Is this the registry not being set up, rather than the registry refusing?
 *
 * "You have not told the app which registry to use" and "the registry could
 * not be reached" are different problems with different fixes, and the
 * operator has to be told which one they are looking at.
 */
export function isMissingRegistryError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /no registry origin|registry origin has not been set/i.test(text);
}

/**
 * The rows as the list shows them.
 *
 * A number that has been removed stays removed even if a refresh that was
 * already on its way brings it back: the remove and the refresh are two
 * separate requests, and the answer that arrives last is not necessarily the
 * newer truth. A row that comes back on its own is a row nobody deleted.
 */
export function withoutRemoved(
  rows: InboxEntry[],
  removedIds: ReadonlySet<string>,
): InboxEntry[] {
  if (removedIds.size === 0) return rows;
  return rows.filter((row) => !removedIds.has(row.id));
}
