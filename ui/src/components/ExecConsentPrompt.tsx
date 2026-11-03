/**
 * The first-time question about command execution, asked inside OraxDesk.
 *
 * WHAT THIS IS FOR. An agent holding `exec` can run a command on a machine the
 * person has open, and until this dialog existed that happened with nobody
 * deciding anything. The decision is now a person's, made once, remembered, and
 * reversible from the AI Agents panel. The prompt appears when an agent asks,
 * which is what makes it a question about something that is actually happening
 * rather than a switch somebody has to find first.
 *
 * WHY IT READS THE STORE RATHER THAN TRUSTING THE EVENT. The shell emits the
 * request whenever a connection finds the question unanswered, which can be
 * twice for two connections. The stored value is the one answer that counts, so
 * this opens only when it is absent: a prompt after somebody already said yes
 * would be the app asking the same question again.
 *
 * WHAT A DISMISSAL MEANS. Closing the dialog leaves the answer unasked, which
 * is still a refusal. Denying is the button, and it writes `denied`; that is
 * what "remembered" means. Either way the agent's call has already been
 * refused with `CONSENT_REQUIRED`, and the sentence it gets says so.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "../lib/i18n";
import { safeInvoke, safeListen } from "../lib/tauri";
import {
  AGENT_EXEC_CONSENT_ALLOWED,
  AGENT_EXEC_CONSENT_DENIED,
  AGENT_EXEC_CONSENT_EVENT,
  AGENT_EXEC_CONSENT_KEY,
  parseExecConsent,
} from "../lib/agentActivity";
import { Dialog } from "./primitives";

export function ExecConsentPrompt(): ReactNode {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void safeListen(AGENT_EXEC_CONSENT_EVENT, () => {
      if (cancelled) return;
      void safeInvoke<string | null>(
        "get_app_setting",
        { key: AGENT_EXEC_CONSENT_KEY },
        null,
      ).then((raw) => {
        if (cancelled) return;
        if (parseExecConsent(raw) === "unasked") setOpen(true);
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

  const decide = useCallback((value: "allowed" | "denied"): void => {
    setOpen(false);
    void safeInvoke(
      "set_app_setting",
      { key: AGENT_EXEC_CONSENT_KEY, value },
      null,
    );
  }, []);

  if (!open) return null;

  return (
    <Dialog title={t("agent.execAskTitle")} onClose={() => setOpen(false)} width={520}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">{t("agent.execAskBody")}</p>
        <p className="text-xs text-tertiary">{t("agent.execAskDeniedNote")}</p>
        {/*
          Allow first and focused, because a person who opened this has already
          seen an agent ask for a command. Deny is still a plain button rather
          than something buried: refusing has to cost one press too.
        */}
        <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <button
            type="button"
            data-autofocus
            className="btn-primary"
            onClick={() => decide(AGENT_EXEC_CONSENT_ALLOWED)}
          >
            {t("agent.execAskAllow")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => decide(AGENT_EXEC_CONSENT_DENIED)}
          >
            {t("agent.execAskDeny")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
