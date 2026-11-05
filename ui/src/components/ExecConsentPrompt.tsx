/**
 * The questions about command execution, asked inside OraxDesk.
 *
 * WHAT THIS IS FOR. An agent holding `exec` can run a command on a machine the
 * person has open, and until this dialog existed that happened with nobody
 * deciding anything. There are two questions now, and they answer different
 * things:
 *
 *  * The first-time question (once, remembered, reversible from the AI Agents
 *    panel): may agents run commands on this computer at all?
 *  * The per-command question (only when the person picked "ask every
 *    command"): may THIS exact command run, with its working directory and
 *    machine spelled out? It is answered for that request alone, and closing
 *    it counts as a no rather than leaving the socket waiting.
 *
 * WHY THE FIRST PROMPT READS THE STORE RATHER THAN TRUSTING THE EVENT. The
 * shell emits the request whenever a connection finds the question
 * unanswered, which can be twice for two connections. The stored value is the
 * one answer that counts, so this opens only when it is absent: a prompt after
 * somebody already said yes would be the app asking the same question again.
 * The per-command prompt is the opposite: every request is its own question,
 * and it shows the command verbatim because the person is approving what will
 * actually run, not a summary of it.
 *
 * WHAT A DISMISSAL MEANS. Closing the first dialog leaves the answer unasked,
 * which is still a refusal. Denying is the button, and it writes `denied`;
 * that is what "remembered" means. Closing the per-command dialog is a no for
 * that command and nothing else, and the mode stays in place.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "../lib/i18n";
import { safeInvoke, safeListen } from "../lib/tauri";
import {
  AGENT_EXEC_CONSENT_ALLOWED,
  AGENT_EXEC_CONSENT_DENIED,
  AGENT_EXEC_CONSENT_EVENT,
  AGENT_EXEC_CONSENT_KEY,
  AGENT_EXEC_REQUEST_EVENT,
  parseExecConsent,
  type ExecRequest,
} from "../lib/agentActivity";
import { Dialog } from "./primitives";

export function ExecConsentPrompt(): ReactNode {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<ExecRequest | null>(null);

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

  // The per-command question. One at a time is enough: the shell holds at most
  // one exec per connection and the socket serialises its own requests, so a
  // second payload replaces a question that has already been answered or
  // expired rather than stacking dialogs.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void safeListen<ExecRequest>(AGENT_EXEC_REQUEST_EVENT, (payload) => {
      if (cancelled) return;
      if (payload && typeof payload.token === "number") setRequest(payload);
    }).then((fn) => {
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

  const answer = useCallback((allow: boolean): void => {
    const current = request;
    setRequest(null);
    if (!current) return;
    void safeInvoke(
      "answer_agent_exec_request",
      { token: current.token, allow },
      null,
    );
  }, [request]);

  if (!open && !request) return null;

  return (
    <>
      {open ? (
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
      ) : null}

      {request ? (
        <Dialog
          title={t("agent.execCommandAskTitle")}
          onClose={() => answer(false)}
          width={560}
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary">{t("agent.execCommandAskBody")}</p>
            {/*
              The command verbatim, LTR: it is a command line, not prose, and
              an RTL context would reorder the punctuation a shell cares about.
            */}
            <pre
              dir="ltr"
              className="max-h-40 overflow-auto rounded-lg border border-subtle bg-inset p-3 text-left text-xs whitespace-pre-wrap break-all"
            >
              {request.command}
            </pre>
            {request.cwd ? (
              <p className="text-xs text-tertiary">
                <span className="font-medium">{t("agent.execCommandAskWhere")}:</span>{" "}
                <span dir="ltr">{request.cwd}</span>
              </p>
            ) : null}
            {request.address ? (
              <p className="text-xs text-tertiary">
                <span className="font-medium">{t("agent.execCommandAskTarget")}:</span>{" "}
                <span dir="ltr">{request.address}</span>
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
              <button
                type="button"
                data-autofocus
                className="btn-primary"
                onClick={() => answer(true)}
              >
                {t("agent.execAskAllow")}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => answer(false)}
              >
                {t("agent.execAskDeny")}
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
