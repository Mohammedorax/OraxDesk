import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { mustInvoke, writeClipboard } from "../lib/tauri";
import { groupDigits } from "./DeviceNumber";
import { IconCheck, IconClipboard, IconMonitor } from "./icons";

interface Identity {
  id: string;
  number: string;
}

/**
 * This computer's nine-digit number, in the top bar, where a person is when
 * somebody asks them for it.
 *
 * It used to be a full-width card on a row of its own under the bar: a whole
 * band of the window for nine digits, and one more thing to scan before
 * reaching the library. The number is a fact about the MACHINE, like the
 * window title, so it belongs beside the name at the top rather than in a
 * section of its own.
 *
 * The number is derived locally (no network), comes from the shell when it is
 * available, and is refreshed when the registry assigns one on registration.
 * Clicking copies it — that is the whole gesture the number exists for.
 */
export function DeviceIdentityChip(): ReactNode {
  const { t } = useI18n();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void mustInvoke<Identity>("machine_identity")
      .then((value) => {
        if (alive && value?.number) setIdentity(value);
      })
      .catch(() => undefined);
    // The registry can assign a different number than the one derived from
    // the key (a collision is disambiguated), so the chip follows whatever
    // the registration settled on.
    const onNumber = (event: Event): void => {
      const next = (event as CustomEvent<string>).detail;
      if (next) setIdentity((previous) => (previous ? { ...previous, number: next } : previous));
    };
    window.addEventListener("oraxdesk:registry-number", onNumber);
    return () => {
      alive = false;
      window.removeEventListener("oraxdesk:registry-number", onNumber);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback((): void => {
    if (!identity) return;
    void writeClipboard(identity.number).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    });
  }, [identity]);

  if (identity === null) return null;

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${t("device.number")}: ${groupDigits(identity.number)}`}
      title={`${t("device.numberHint")} ${t("device.copyNumber")}`}
      className="group flex min-w-0 shrink items-center gap-2 rounded-md border border-subtle bg-inset/50 px-2.5 py-1 transition-colors hover:border-strong"
    >
      <IconMonitor size={14} className="shrink-0 text-tertiary" />
      {/*
        The label is the secondary half and may be clipped when the bar is
        narrow; the digits below never are. The person reads the number aloud,
        so it is the largest thing in the chip and the one that must survive
        every window width.
      */}
      <span className="min-w-0 truncate text-2xs text-tertiary" title={t("device.numberLabel")}>
        {copied ? t("device.copied") : t("device.numberLabel")}
      </span>
      {/*
        The spaces between the groups are bidi neutrals: in an Arabic
        paragraph "123 456 789" would be laid out right to left. The run is
        isolated and pinned LTR so the digits stay in the order they are in.
        Tabular figures keep each digit in its own column, so the number does
        not jump sideways when it is refreshed or when a neighbouring control
        changes width.
      */}
      <span
        dir="ltr"
        style={{ unicodeBidi: "isolate" }}
        className="mono shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums tracking-wide text-primary"
      >
        {groupDigits(identity.number)}
      </span>
      {copied ? (
        <IconCheck size={14} className="shrink-0 text-success" />
      ) : (
        <IconClipboard size={14} className="shrink-0 text-tertiary group-hover:text-primary" />
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? t("device.copied") : ""}
      </span>
    </button>
  );
}
