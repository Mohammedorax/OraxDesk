import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { mustInvoke, writeClipboard } from "../lib/tauri";
import { classNames } from "../lib/util";
import {
  checkDeviceStatus,
  deviceStatusLook,
  DEVICE_TONE_CLASS,
  type DeviceStatus,
} from "../lib/deviceStatus";
import { groupDigits } from "./DeviceNumber";
import { IconCheck, IconClipboard, IconMonitor, IconRefresh } from "./icons";

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
 * It now also says whether anybody can reach this number, because "read out
 * your number" is only half of the exchange: the person asking needs the
 * registry to have an address for this computer, and the person reading it out
 * has no other way to find that out.
 *
 * That state is asked for ONCE PER CLICK and never polled. The registry is
 * rate limited and its free plan has a daily request budget, so a card that
 * refreshed itself in the background would spend that budget on a screen
 * nobody is reading. The strip and the sentence are two carriers of the same
 * fact, deliberately: colour alone is unreadable to some people.
 */
export function DeviceIdentityChip(): ReactNode {
  const { t } = useI18n();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<DeviceStatus>("unchecked");
  const [checking, setChecking] = useState(false);
  /** Whether a check has ever finished, so the live region stays quiet at rest. */
  const [asked, setAsked] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  /** The check in flight, read by the click handler that may start another. */
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    void mustInvoke<Identity>("machine_identity")
      .then((value) => {
        if (alive && value?.number) setIdentity(value);
      })
      .catch(() => undefined);
    // The registry can assign a different number than the one derived from
    // the key (a collision is disambiguated), so the chip follows whatever
    // the registration settled on. What the last check said was about the OLD
    // number, so it is discarded rather than shown against the new one.
    const onNumber = (event: Event): void => {
      const next = (event as CustomEvent<string>).detail;
      if (!next) return;
      setIdentity((previous) => (previous ? { ...previous, number: next } : previous));
      setStatus("unchecked");
      setAsked(false);
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

  const check = useCallback((): void => {
    if (!identity || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    void checkDeviceStatus(identity.number)
      .then((next) => {
        setStatus(next);
        setAsked(true);
      })
      .finally(() => {
        inFlight.current = false;
        setChecking(false);
      });
  }, [identity]);

  if (identity === null) return null;

  const look = deviceStatusLook(status);
  const sentence = t(look.labelKey);

  return (
    <div
      className="flex shrink-0 items-stretch overflow-hidden rounded-md border border-subtle bg-inset/50"
      aria-busy={checking || undefined}
    >
      {/* The inline-start edge states the colour. It is the second carrier,
          never the only one: the sentence below the digits says the same
          thing in words. */}
      <span aria-hidden="true" className={classNames("w-[3px] shrink-0", DEVICE_TONE_CLASS[look.tone])} />
      <button
        type="button"
        onClick={copy}
        // The name carries the action, the digits and the state, so a screen
        // reader hears the whole card from the one control that copies it.
        aria-label={`${t("device.copyNumber")}: ${groupDigits(identity.number)}. ${sentence}`}
        title={`${t("device.numberHint")} ${t("device.copyNumber")}`}
        className="group flex min-w-0 flex-col items-start gap-0.5 px-2.5 py-1 text-start transition-colors hover:bg-inset"
      >
        <span className="flex items-center gap-1.5">
          <IconMonitor size={13} className="shrink-0 text-tertiary" />
          {/*
            The spaces between the groups are bidi neutrals: in an Arabic
            paragraph "123 456 789" would be laid out right to left. The run is
            isolated and pinned LTR so the digits stay in the order they are
            in, tabular figures keep each digit in its own column, and the
            number is never truncated: it is the thing a person reads aloud.
          */}
          <span
            dir="ltr"
            style={{ unicodeBidi: "isolate" }}
            className="mono shrink-0 whitespace-nowrap text-base font-semibold leading-tight tabular-nums tracking-wide text-primary"
          >
            {groupDigits(identity.number)}
          </span>
          {copied ? (
            <IconCheck size={13} className="shrink-0 text-success" />
          ) : (
            <IconClipboard
              size={13}
              className="shrink-0 text-tertiary group-hover:text-primary"
            />
          )}
        </span>
        <span
          className="max-w-[22rem] truncate text-2xs text-tertiary"
          title={sentence}
        >
          {sentence}
        </span>
      </button>
      {/* The one way to ask. Named, because an icon on its own is a guess, and
          disabled while asking so a second click cannot spend a second lookup
          on the same answer. */}
      <button
        type="button"
        onClick={check}
        disabled={checking}
        aria-label={t("device.status.check")}
        title={t("device.status.check")}
        className="shrink-0 border-s border-subtle px-1.5 text-tertiary transition-colors hover:bg-inset hover:text-primary disabled:opacity-60"
      >
        <IconRefresh size={13} className={checking ? "animate-spin" : undefined} />
      </button>
      <span className="sr-only" aria-live="polite">
        {asked ? sentence : ""}
      </span>
    </div>
  );
}
