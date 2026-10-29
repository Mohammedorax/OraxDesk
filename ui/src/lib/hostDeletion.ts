/**
 * The Library's delete affordance: what the trash button in the sidebar may
 * act on.
 *
 * The WORDS live in the catalogue and the DECISIONS live here, the same split
 * the support inbox uses (`inbox.ts`): a selection is a set of ids, an id can
 * name a machine that is no longer there, and a delete must never be aimed at
 * something that is not on screen.
 */
import type { HostProfile } from "./types";

/** Why the delete button cannot act at this moment. */
export type DeleteBlocked = "empty";

export interface DeleteSelection {
  /** The machines the button would delete, in the library's own order. */
  targets: HostProfile[];
  /** Null when the button is live; the reason it is not otherwise. */
  blocked: DeleteBlocked | null;
}

/**
 * The machines a delete gesture may act on.
 *
 * The selection holds ids, and an id can outlive its machine: a host deleted
 * in another window, or a selection kept across a filter change, leaves an id
 * that names nothing. Deleting by such an id would ask the backend about a
 * machine that is not there, so the ids are resolved against the library and
 * the ones that resolve to nothing are dropped.
 *
 * The library's order is kept rather than the selection's, so the names in
 * the confirmation read the way the tiles do.
 */
export function deleteSelection(
  hosts: HostProfile[],
  selectedIds: Iterable<string>,
): DeleteSelection {
  const wanted = new Set(selectedIds);
  const targets = hosts.filter((host) => wanted.has(host.id));
  return { targets, blocked: targets.length === 0 ? "empty" : null };
}
