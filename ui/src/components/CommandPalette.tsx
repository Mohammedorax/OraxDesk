/** Cmd/Ctrl+K command palette: fuzzy-matches hosts AND actions (PRD/03 §2.3). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "../lib/i18n";
import { fuzzyMatch } from "../lib/util";
import type { HostProfile } from "../lib/types";
import { Dialog } from "./primitives";
import { IconMonitor, IconZap } from "./icons";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Entry {
  key: string;
  label: string;
  sub: string;
  kind: "host" | "action";
  score: number;
  run: () => void;
}

export function CommandPalette({
  hosts,
  actions,
  onConnect,
  onClose,
}: {
  hosts: HostProfile[];
  actions: PaletteAction[];
  onConnect: (host: HostProfile) => void;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo((): Entry[] => {
    const out: Entry[] = [];
    for (const h of hosts) {
      const hay = `${h.friendlyName} ${h.address}`;
      const m = fuzzyMatch(query, hay);
      if (m) {
        out.push({
          key: `host-${h.id}`,
          label: h.friendlyName,
          sub: `${h.address}:${h.port}`,
          kind: "host",
          score: m.score + 10, // hosts get a slight edge
          run: () => onConnect(h),
        });
      }
    }
    for (const a of actions) {
      const m = fuzzyMatch(query, a.label);
      if (m) {
        out.push({
          key: `action-${a.id}`,
          label: a.label,
          sub: a.hint ?? "",
          kind: "action",
          score: m.score,
          run: a.run,
        });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 12);
  }, [query, hosts, actions, onConnect]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (entries.length === 0) return;
      e.preventDefault();
      setSelected((s) =>
        e.key === "ArrowDown"
          ? Math.min(entries.length - 1, s + 1)
          : Math.max(0, s - 1),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[selected];
      if (entry) {
        onClose();
        entry.run();
      }
    }
    // Escape is not this component's to handle: the dialog shell answers it
    // wherever the focus sits, so it cannot die when the focus moves off the
    // input and onto the close button.
  };

  return (
    <Dialog title={t("common.commandPalette")} onClose={onClose} width={560}>
      {/*
        The combobox keeps the DOM focus in the field and points at the
        highlighted row with `aria-activedescendant`, the same contract
        QuickConnect implements. The rows are out of the tab order: a focusable
        option would put the whole list in the tab sequence, and a keyboard user
        would walk through twelve rows that the arrow keys are supposed to
        drive.
      */}
      <div onKeyDown={onKeyDown}>
        <input
          data-autofocus
          className="w-full rounded-md border border-subtle bg-inset px-3 py-2.5 text-base text-primary outline-none placeholder:text-tertiary focus:border-accent"
          placeholder={t("common.commandPalettePlaceholder")}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-label={t("common.commandPalette")}
          aria-activedescendant={entries.length === 0 ? undefined : `palette-option-${selected}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div
          ref={listRef}
          id="palette-list"
          role="listbox"
          aria-label={t("common.commandPalette")}
          className="mt-2 max-h-80 overflow-y-auto"
        >
          {entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-tertiary">
              {t("common.noPaletteMatch", { query })}
            </div>
          ) : (
            entries.map((entry, i) => (
              <button
                key={entry.key}
                type="button"
                id={`palette-option-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === selected}
                tabIndex={-1}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-start ${
                  i === selected ? "bg-accent text-accent-fg" : "text-primary hover:bg-inset"
                }`}
                onPointerMove={() => setSelected(i)}
                onClick={() => {
                  onClose();
                  entry.run();
                }}
              >
                <span className={i === selected ? "opacity-90" : "text-tertiary"}>
                  {entry.kind === "host" ? <IconMonitor size={16} /> : <IconZap size={16} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.label}</span>
                {entry.sub ? (
                  <span
                    className={`mono truncate text-xs ${i === selected ? "opacity-75" : "text-tertiary"}`}
                  >
                    {entry.sub}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
