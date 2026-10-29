/**
 * The Library sidebar's delete affordance.
 *
 * A trash button that acts on the machines the person has selected in the
 * grid beside it. It is a small quiet icon rather than another full-width
 * button: the sidebar already carries three of those at the foot, and a
 * fourth would read as a peer of "Get help" rather than as a delete.
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
  /** The machines the button would delete. Empty means it cannot act. */
  targets: HostProfile[];
  /** Ask before anything is deleted. */
  onAsk: () => void;
}): ReactNode {
  const t = useT();
  const ready = targets.length > 0;
  const one = targets.length === 1 ? targets[0] : null;

  /**
   * The name of the button says what it would DO, and the hint beside it
   * says what it would act on. Both are needed: a trash icon on its own
   * does not say which machine is in question, and a machine's name on its
   * own does not say that the icon next to it is the thing that removes it.
   */
  const name = one
    ? t("library.deleteSelectedTitle", { name: one.friendlyName })
    : ready
      ? t("library.deleteSelectedTitleMany", { count: targets.length })
      : t("library.deleteSelected");
  const hint = one
    ? one.friendlyName
    : ready
      ? t("library.deleteSelectedMany", { count: targets.length })
      : t("library.deleteNothingSelected");

  return (
    <>
      <button
        type="button"
        aria-label={name}
        // The reason a disabled control cannot be used is in the tooltip for
        // a mouse and in the description for a screen reader: a greyed-out
        // button with no reason is a dead end.
        aria-describedby={HINT_ID}
        title={ready ? name : t("library.deleteNothingSelected")}
        disabled={!ready}
        className="rounded-sm p-1.5 text-tertiary hover:bg-inset hover:text-danger disabled:cursor-default disabled:text-tertiary/40 disabled:hover:bg-transparent disabled:hover:text-tertiary/40"
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
