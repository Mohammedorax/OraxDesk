/**
 * Connecting / reconnecting / disconnected overlays for a session window.
 *
 * Pulled out of `Session.tsx` so `SshSession.tsx` can render the exact same
 * panels over a terminal that `SessionView` renders over the framebuffer
 * canvas, rather than a second copy that drifts from the original the next
 * time the wording or the reconnect countdown changes. Nothing in here is
 * VNC/RDP specific; the only per-protocol shaping (auth method labels, the
 * "security settings" deep link) already lives behind props the caller
 * supplies.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { authMethodLabel } from "../hooks/useSession";
import { diagnose, INVITATION_SPENT, isAuthFailure, opensSecuritySettings } from "../lib/diagnose";
import { useT, type Translate } from "../lib/i18n";
import type { SessionState } from "../lib/types";

// -------------------------------------------------------- connecting overlay

const STAGES = ["resolving", "connecting", "authenticating", "negotiating"] as const;

/**
 * The name of each stage, as a key in the catalogue.
 *
 * The stage list shows all four, with the one in flight spelled out. The
 * stage in flight is the one that carries the method, so the plain name is
 * what the other three rows use.
 */
const STAGE_LABELS = {
  resolving: "overlay.stageResolving",
  connecting: "overlay.stageConnecting",
  authenticating: "overlay.stageAuthenticating",
  negotiating: "overlay.stageNegotiating",
} as const;

/**
 * How long the connecting panel waits before it says something more.
 *
 * Ten seconds is long enough that a normal handshake never sees the extra
 * line, and short enough that a person whose machine is off is not left
 * staring at "Connecting" with nothing to act on.
 */
const SLOW_CONNECT_MS = 10_000;

function stageLabel(t: Translate, st: SessionState): string {
  switch (st.state) {
    case "resolving":
      return t("overlay.stageResolving");
    case "connecting":
      return t("overlay.stageConnecting");
    case "authenticating":
      // The wire value is a stable identifier, so the copy is the UI's own.
      // An unrecognised one comes back verbatim rather than as a blank.
      return `${t("overlay.stageAuthenticating")} (${authMethodLabel(st.method)})`;
    case "negotiating":
      return t("overlay.stageNegotiating");
    default:
      return t("overlay.stagePreparing");
  }
}

export function ConnectingOverlay({ state, name }: { state: SessionState; name: string }): ReactNode {
  const t = useT();
  const idx = STAGES.indexOf(state.state as (typeof STAGES)[number]);
  /**
   * How long the connection has been trying.
   *
   * The panel names the stage and stops there, so a person whose machine is
   * off or asleep waits with nothing but "Connecting" and no idea whether the
   * app is working. After a while it says so, and says what to check.
   */
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_CONNECT_MS);
    return () => window.clearTimeout(timer);
  }, [state.state]);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-canvas" role="status" aria-live="polite">
      <div className="w-80 rounded-lg border border-subtle bg-surface p-5 shadow-(--shadow-pop)">
        <p className="mb-3 text-sm font-medium text-primary">
          {t("library.connectingTo", { address: name })}
        </p>
        <ol className="space-y-1.5">
          {STAGES.map((s, i) => (
            <li key={s} className="flex items-center gap-2 text-xs">
              <span
                className={
                  i < idx
                    ? "h-1.5 w-1.5 rounded-full bg-success"
                    : i === idx
                      ? "h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                      : "h-1.5 w-1.5 rounded-full bg-inset"
                }
              />
              <span className={i === idx ? "text-primary" : "text-tertiary"}>
                {i === idx ? stageLabel(t, state) : t(STAGE_LABELS[s])}
              </span>
            </li>
          ))}
        </ol>
        {slow ? (
          <p className="mt-3 border-t border-subtle pt-3 text-xs text-secondary">
            {t("overlay.stillTrying")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// --------------------------------------------------------- reconnect overlay

export function ReconnectOverlay({
  name,
  attempt,
  nextRetryMs,
  reason,
  onRetryNow,
  onDisconnect,
}: {
  name: string;
  attempt: number;
  nextRetryMs: number;
  reason: string;
  onRetryNow: () => void;
  onDisconnect: () => void;
}): ReactNode {
  const t = useT();
  const [remaining, setRemaining] = useState(nextRetryMs);
  useEffect(() => {
    setRemaining(nextRetryMs);
    const started = performance.now();
    const iv = window.setInterval(() => {
      const left = nextRetryMs - (performance.now() - started);
      setRemaining(Math.max(0, left));
      if (left <= 0) window.clearInterval(iv);
    }, 250);
    return () => window.clearInterval(iv);
  }, [nextRetryMs, attempt]);

  const secs = Math.ceil(remaining / 1000);

  // Translucent scrim OVER the last known frame, never a blank screen.
  return (
    <div
      className="fade-in absolute inset-0 z-20 flex items-center justify-center bg-scrim"
      role="alert"
      aria-live="assertive"
    >
      <div className="w-96 max-w-[calc(100vw-32px)] rounded-lg border border-subtle bg-raised p-5 shadow-(--shadow-pop)">
        <div className="mb-1 overflow-hidden rounded-pill bg-inset">
          <div className="indeterminate-bar h-0.5 w-1/3 bg-accent" />
        </div>
        <p className="mt-3 text-sm font-medium text-primary">
          {t("overlay.reconnectingTo", { name, attempt })}
          {secs > 0 ? t("overlay.retryingIn", { secs }) : t("overlay.retryingNow")}
        </p>
        {reason ? <p className="mt-1 text-xs text-secondary">{reason}</p> : null}
        <div className="mt-4 flex justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={onDisconnect}>
            {t("overlay.disconnect")}
          </button>
          <button type="button" className="btn-primary" onClick={onRetryNow}>
            {t("overlay.retryNow")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------- terminal disconnect
//
// `diagnose` and `isAuthFailure` live in `lib/diagnose.ts`. They are pure
// string-to-string functions with no React in them, and the vitest include
// pattern does not collect `.tsx`, so while they were here the branch
// ordering everything below depends on could not be tested at all.

export function DisconnectedOverlay({
  name,
  reason,
  canRetry,
  symbol,
  profileId,
  onEditSecurity,
  onReconnect,
  onNewInvitation,
  onClose,
}: {
  name: string;
  reason: string;
  canRetry: boolean;
  /** The protocol''s own name for the failure, when it has one. */
  symbol?: string;
  /** Null for an ad-hoc session: there is no profile to open in the editor. */
  profileId: string | null;
  onEditSecurity: (() => void) | null;
  onReconnect: (options?: { reprompt?: boolean }) => void;
  /**
   * Open the entry for a NEW invitation code, for a session whose code is
   * spent (see `INVITATION_SPENT`). Null where there is none to offer — a
   * terminal beside a session never opens one, and this symbol is never
   * theirs anyway.
   */
  onNewInvitation?: (() => void) | null;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  // Move focus off the canvas: it keeps Enter/Space on the default action and
  // takes the keystrokes out of the remote input hook's reach.
  useEffect(() => {
    const el = panelRef.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ??
      el?.querySelector<HTMLElement>("button"))?.focus();
  }, []);

  const text = typeof reason === "string" ? reason : "";
  const authFailure = isAuthFailure(text, symbol);
  const securityFix = opensSecuritySettings(text, symbol);
  // A spent invitation is never offered a reconnect: the code was single use
  // and is gone, so the only action that can lead anywhere is a NEW one.
  const spentInvitation = symbol === INVITATION_SPENT;
  // A rejected password is ALWAYS retryable from the user's side, whatever the
  // core said: `can_retry: false` means "do not reconnect automatically", not
  // "there is nothing this person can do". Offering only a Close button after
  // three wrong attempts is the dead end the report was about.
  const retryable = !spentInvitation && (canRetry || authFailure);

  return (
    <div className="fade-in absolute inset-0 z-30 flex items-center justify-center bg-scrim">
      {/*
        `role="dialog"` is load-bearing, not decoration: the remote keyboard hook
        (render/input.ts `LOCAL_UI_SELECTOR`) uses it to tell our own overlays
        from the remote desktop, so without it every keystroke in here would be
        forwarded and preventDefault-ed.
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("overlay.disconnectedFrom", { name })}
        className="w-96 max-w-[calc(100vw-32px)] rounded-lg border border-subtle bg-raised p-5 shadow-(--shadow-pop)"
      >
        {/*
          Both lines break inside a word, which for once is the right kind of
          ugly. A machine name can be a long unbroken string, and a disconnect
          reason can carry an SSH fingerprint: forty-odd characters with no
          space, no hyphen and nowhere for the browser to wrap, which is
          exactly what ran off the side of this panel.
        */}
        <p className="text-base font-semibold break-words text-primary">
          {t("overlay.disconnectedFrom", { name })}
        </p>
        <p className="mt-2 text-sm break-words text-secondary" role="alert">
          {(() => {
            const diagnosis = diagnose(reason, symbol);
            return t(diagnosis.key, diagnosis.args);
          })()}
        </p>
        {authFailure ? (
          <p className="mt-1.5 text-xs text-tertiary">
            {t("overlay.reconnectAsksPassword")}
          </p>
        ) : null}
        {/*
          The message above names a setting, so the panel offers the way to
          it rather than making the user find the host in the library first.
          An ad-hoc session has no profile to edit, so it gets the sentence
          that says what to do instead.
        */}
        {securityFix ? (
          profileId && onEditSecurity ? (
            <button
              type="button"
              className="mt-2.5 text-xs font-medium text-accent underline underline-offset-2"
              onClick={onEditSecurity}
            >
              {t("overlay.openSecurity")}
            </button>
          ) : (
            <p className="mt-1.5 text-xs text-tertiary">
              {t("overlay.saveFirst")}
            </p>
          )
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("about.close")}
          </button>
          {retryable ? (
            <button
              type="button"
              data-autofocus
              className="btn-primary"
              onClick={() => onReconnect(authFailure ? { reprompt: true } : undefined)}
            >
              {t("overlay.reconnect")}
            </button>
          ) : null}
          {/*
            A spent code's only way back in is a NEW one, so this opens the
            same entry the library opens from its "Help someone" button,
            rather than a reconnect the single-use code cannot survive.
          */}
          {spentInvitation && onNewInvitation ? (
            <button
              type="button"
              data-autofocus
              className="btn-primary"
              onClick={onNewInvitation}
            >
              {t("overlay.newCode")}
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-end text-2xs text-tertiary">{t("overlay.pressEsc")}</p>
      </div>
    </div>
  );
}
