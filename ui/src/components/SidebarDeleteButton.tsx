/**
 * The Library sidebar's delete affordance.
 *
 * A trash button that acts on the machines the person has selected in the
 * grid beside it. It is a small quiet icon rather than another full-width
 * button: the sidebar already carries three of those at the foot, and a
 * fourth would read as a peer of "Get help" rather than as a delete.
 *
 * It exists only while there is a selection. A permanently visible trash can
 * says that deleting is something this window always offers, and a disabled
 * one says there is a reason to look at it and work out why; what the button
 * does depends entirely on the grid, so it appears with the selection and
 * leaves with it.
 *
 * The button is never the last step. It asks, and the Library's own
 * confirmation does the deleting: a delete that happened on one click would
 * be the only destructive gesture in the app that cannot be seen coming.
 */
import type { ReactNode } from "react";
import { IconTrash } from "./icons";
import { useT } from "../lib/i18n";
import type { HostProfile } from "../lib/types";

/** The hint line's id, so the button can point a screen reader at it. */
const HINT_ID = "library-delete-hint";

export function SidebarDeleteButton({
  targets,
  onAsk,
}: {
  /** The machines the button would delete. Empty means there is nothing to show. */
  targets: HostProfile[];
  /** Ask before anything is deleted. */
  onAsk: () => void;
}): ReactNode {
  const t = useT();
  if (targets.length === 0) return null;
  const one = targets.length === 1 ? targets[0] : null;

  /**
   * The name of the button says what it would DO, and the hint beside it
   * says what it would act on. Both are needed: a trash icon on its own
   * does not say which machine is in question, and a machine's name on its
   * own does not say that the icon next to it is the thing that removes it.
   */
  const name = t.plural("library.deleteSelectedTitle", targets.length, {
    name: one?.friendlyName ?? "",
  });
  const hint = one
    ? one.friendlyName
    : t.plural("library.selectedCount", targets.length);

  return (
    <>
      <button
        type="button"
        aria-label={name}
        aria-describedby={HINT_ID}
        title={name}
        className="rounded-sm p-1.5 text-tertiary hover:bg-inset hover:text-danger"
        onClick={onAsk}
      >
        <IconTrash size={15} />
      </button>
      <span id={HINT_ID} className="min-w-0 flex-1 truncate text-2xs text-tertiary">
        {hint}
      </span>
    </>
  );
}
