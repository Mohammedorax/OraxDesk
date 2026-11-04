/**
 * The first-time question about opening one machine.
 *
 * WHAT THIS IS FOR. An agent that can open a machine can watch it and drive it,
 * and before this dialog existed the first time any agent reached a saved
 * machine that happened with nobody deciding anything. The decision is now a
 * person's, made once per machine, remembered, and reversible from the AI
 * Agents panel. The prompt appears when an agent asks to open a machine, which
 * is what makes it a question about something that is actually happening.
 *
 * WHY IT READS THE ANSWERS RATHER THAN TRUSTING THE EVENT. The shell asks at
 * most once per connection per machine, but two connections can find the same
 * question unanswered and both emit. The stored answer is the one that counts,
 * so this opens only when the named machine still has no row: a prompt after
 * somebody already answered would be the app asking the same question again.
 *
 * WHAT A DISMISSAL MEANS. Closing the dialog leaves that machine unasked, which
 * is still a refusal. Denying is the button, and it writes `denied`; that is
 * what "remembered" means. Either way the agent's call has already been refused
 * with `CONSENT_REQUIRED`, and the sentence it gets says so.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "../lib/i18n";
import { safeInvoke, safeListen } from "../lib/tauri";
import {
  AGENT_HOST_ACCESS_COMMAND,
  AGENT_HOST_CONSENT_EVENT,
  AGENT_SET_HOST_ACCESS_COMMAND,
  parseHostAccess,
  parseHostConsentAsk,
  type HostConsentAsk,
} from "../lib/agentActivity";
import { Dialog } from "./primitives";

export function HostConsentPrompt(): ReactNode {
  const t = useT();
  const [ask, setAsk] = useState<HostConsentAsk | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void safeListen<unknown>(AGENT_HOST_CONSENT_EVENT, (payload) => {
      if (cancelled) return;
      const next = parseHostConsentAsk(payload);
      if (!next) return;
      void safeInvoke<unknown>(AGENT_HOST_ACCESS_COMMAND, undefined, []).then((raw) => {
        if (cancelled) return;
        // A machine answered since the event was emitted is not a question any
        // more. Matching on the normalised address is why one spelling cannot
        // slip past a row written under another.
        const answered = parseHostAccess(raw).some((row) => row.address === next.address);
        if (!answered) setAsk(next);
      });
    }).then((fn) => {
      // `safeListen` resolves after the effect can already have been cleaned
      // up, and a listener registered then is one nobody can remove.
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const decide = useCallback(
    (verdict: "allowed" | "denied"): void => {
      const target = ask;
      setAsk(null);
      if (!target) return;
      void safeInvoke(
        AGENT_SET_HOST_ACCESS_COMMAND,
        { address: target.address, verdict },
        null,
      );
    },
    [ask],
  );

  if (!ask) return null;

  // The saved name is what a person recognises; the address is what the shell
  // keys the answer by, and the only label an unsaved machine has.
  const label = ask.name ?? ask.address;

  return (
    <Dialog
      title={t("agent.hostAskTitle", { name: label })}
      onClose={() => setAsk(null)}
      width={520}
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary">{t("agent.hostAskBody", { name: label })}</p>
        {ask.name ? (
          <p className="mono text-2xs text-tertiary" dir="ltr">
            {ask.address}
          </p>
        ) : null}
        <p className="text-xs text-tertiary">{t("agent.hostAskDeniedNote")}</p>
        {/*
          Allow first and focused, because a person who opened this has already
          seen an agent ask for a machine. Deny is still a plain button rather
          than something buried: refusing has to cost one press too.
        */}
        <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <button
            type="button"
            data-autofocus
            className="btn-primary"
            onClick={() => decide("allowed")}
          >
            {t("agent.hostAskAllow")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => decide("denied")}
          >
            {t("agent.hostAskDeny")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
