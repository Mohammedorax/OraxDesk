/**
 * The confirmation the sidebar's trash button asks before it deletes.
 *
 * The shared Dialog primitive in its `danger` variant, the same shape as the
 * certificate prompt's hard stop: the question is the title, the machines
 * are the body, and the focus starts on Cancel so that a person who reached
 * for the keyboard is not one keystroke away from the delete.
 */
import type { ReactNode } from "react";
import { Dialog } from "./primitives";
import { useT } from "../lib/i18n";
import type { HostProfile } from "../lib/types";

export function DeleteHostsDialog({
  hosts,
  onConfirm,
  onCancel,
}: {
  /** The machines that would be deleted. */
  hosts: HostProfile[];
  onConfirm: () => void;
  onCancel: () => void;
}): ReactNode {
  const t = useT();
  const one = hosts.length === 1 ? hosts[0] : null;
  return (
    <Dialog
      title={t.plural("library.deleteConfirmTitle", hosts.length)}
      onClose={onCancel}
      danger
      width={440}
      initialFocusSelector="[data-cancel]"
    >
      <div className="space-y-3">
        <p className="text-sm text-primary">
          {t.plural("library.deleteConfirmBody", hosts.length, {
            name: one?.friendlyName ?? "",
          })}
        </p>
        {/*
          The names are listed rather than counted alone: "three computers"
          is not something a person can check against what they selected, and
          a delete that removes the wrong one cannot be undone.
        */}
        {one ? null : (
          <ul
            className="max-h-40 overflow-y-auto rounded-md border border-subtle bg-inset p-2 text-sm"
            aria-label={t("library.deleteConfirmList")}
          >
            {hosts.map((host) => (
              <li key={host.id} className="truncate px-1 py-0.5 text-secondary">
                {host.friendlyName}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2.5">
          <button type="button" data-cancel className="btn-secondary" onClick={onCancel}>
            {t("host.cancel")}
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            {t("library.deleteConfirmAction")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
