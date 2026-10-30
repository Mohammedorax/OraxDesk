/**
 * The Runbooks dialog: recipes that compose a command, and say who runs it.
 *
 * WHAT THIS SCREEN IS HONEST ABOUT. The webview cannot reach the remote
 * machine's shell, and `dvv_job` lives in the agent process, so there is no
 * button here that could run anything. The dialog composes the exact command,
 * copies it, and states both routes a person actually has: an agent runs it
 * through `dvv_job`, or the person pastes it into a terminal on that machine.
 * A "Run" button would be the one lie this screen exists to avoid.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, Select } from "./primitives";
import { useI18n } from "../lib/i18n";
import { writeClipboard } from "../lib/tauri";
import { classNames } from "../lib/util";
import {
  RUNBOOKS,
  SECRET_PLACEHOLDER,
  composeRunbook,
  runbookDefaults,
  type ComposeRefusal,
  type Runbook,
} from "../lib/runbooks";
import { IconAlert, IconCheck, IconClipboard, IconLock, IconTerminal } from "./icons";

/** How long a copy button says it copied. Long enough to be seen, no longer. */
const COPIED_MS = 1600;

type CopyState = "idle" | "copied" | "failed";

/** The parameters a refusal names, in words, in the reader's language. */
function refusalText(
  recipe: Runbook,
  refusal: ComposeRefusal,
  t: ReturnType<typeof useI18n>["t"],
  separator: string,
): string {
  const names = refusal.params
    .map((id) => {
      const param = recipe.params.find((candidate) => candidate.id === id);
      return param ? t(param.labelKey) : id;
    })
    .join(separator);
  switch (refusal.reason) {
    case "missing":
      return t("runbooks.missing", { params: names });
    case "invalid":
      return t("runbooks.invalid", { params: names });
    case "unknown":
      return t("runbooks.unknown", { params: names });
  }
}

export function RunbooksDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { t, lang } = useI18n();
  const [recipeId, setRecipeId] = useState(RUNBOOKS[0].id);
  const recipe = RUNBOOKS.find((candidate) => candidate.id === recipeId) ?? RUNBOOKS[0];
  const [values, setValues] = useState<Record<string, string>>(() => runbookDefaults(RUNBOOKS[0]));
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const result = useMemo(() => composeRunbook(recipe, values), [recipe, values]);

  const pick = useCallback((id: string): void => {
    const next = RUNBOOKS.find((candidate) => candidate.id === id);
    if (!next) return;
    setRecipeId(next.id);
    setValues(runbookDefaults(next));
    setCopyState("idle");
  }, []);

  const copy = useCallback((): void => {
    if (!result.ok) return;
    void writeClipboard(result.command).then((ok) => {
      setCopyState(ok ? "copied" : "failed");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopyState("idle"), ok ? COPIED_MS : COPIED_MS * 2);
    });
  }, [result]);

  const hasSecret = recipe.params.some((param) => param.secret);
  const refusal =
    result.ok === false ? refusalText(recipe, result, t, lang === "ar" ? "، " : ", ") : null;

  return (
    <Dialog title={t("runbooks.title")} onClose={onClose} width={680} initialFocusSelector="[data-recipe]">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm text-primary">{t("runbooks.intro")}</p>
          <p className="text-xs text-secondary">{t("runbooks.noRunNote")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
          {/* The whole list is visible, not folded into a dropdown: choosing a
              recipe is the first thing a person does here, and the names are
              the only thing they have to go on until they read one. */}
          <nav className="space-y-0.5" aria-label={t("runbooks.recipeList")}>
            {RUNBOOKS.map((candidate) => {
              const active = candidate.id === recipe.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  data-recipe
                  aria-current={active ? "true" : undefined}
                  className={classNames(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm",
                    active
                      ? "bg-accent/15 font-medium text-primary"
                      : "text-secondary hover:bg-inset hover:text-primary",
                  )}
                  onClick={() => pick(candidate.id)}
                >
                  <IconTerminal
                    size={14}
                    className={active ? "shrink-0 text-accent" : "shrink-0 text-tertiary"}
                  />
                  <span className="min-w-0 flex-1">{t(candidate.nameKey)}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 space-y-4">
            <p className="text-sm text-secondary">{t(recipe.purposeKey)}</p>

            {recipe.params.length > 0 ? (
              <section className="space-y-2.5" aria-label={t("runbooks.parameters")}>
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-tertiary">
                  {t("runbooks.parameters")}
                </h3>
                {recipe.params.map((param) => (
                  <label key={param.id} className="block space-y-1">
                    <span className="text-xs font-medium text-secondary">{t(param.labelKey)}</span>
                    {param.secret ? (
                      /*
                        No input at all. Asking for a password here would mean
                        holding it in React state and in the DOM for no gain: the
                        command carries a placeholder either way, and the person
                        types the real value on the machine.
                      */
                      <span className="flex items-center gap-2 rounded-sm border border-subtle bg-inset px-2 py-1.5 text-sm">
                        <IconLock size={13} className="text-tertiary" />
                        <code className="mono text-primary">{SECRET_PLACEHOLDER}</code>
                        <span className="text-2xs text-tertiary">{t("runbooks.secretValue")}</span>
                      </span>
                    ) : param.kind === "choice" ? (
                      <Select
                        value={values[param.id] ?? param.defaultValue ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setValues((previous) => ({ ...previous, [param.id]: value }));
                          setCopyState("idle");
                        }}
                      >
                        {(param.choices ?? []).map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {t(choice.labelKey)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      /*
                        A path is left to right even in an Arabic window: it is
                        a run of Windows characters, not a sentence, and a
                        mirrored path is a path someone will mistype.
                      */
                      <input
                        type="text"
                        dir={param.kind === "path" ? "ltr" : undefined}
                        spellCheck={false}
                        className={classNames("field", param.kind === "path" && "mono")}
                        value={values[param.id] ?? param.defaultValue ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setValues((previous) => ({ ...previous, [param.id]: value }));
                          setCopyState("idle");
                        }}
                      />
                    )}
                  </label>
                ))}
              </section>
            ) : null}

            <div className="flex items-start gap-2 rounded-md border border-subtle bg-inset/60 p-2.5 text-xs text-secondary">
              <IconLock size={14} className="mt-0.5 shrink-0 text-tertiary" />
              <p>
                <span className="font-medium text-primary">{t("runbooks.elevationLabel")}: </span>
                {t(recipe.elevationKey)}
              </p>
            </div>

            {recipe.noteKey ? (
              <p className="flex items-start gap-2 text-xs text-secondary">
                <IconAlert size={14} className="mt-0.5 shrink-0 text-tertiary" />
                {t(recipe.noteKey)}
              </p>
            ) : null}

            {hasSecret ? (
              <p className="flex items-start gap-2 rounded-md border border-subtle bg-inset/60 p-2.5 text-xs text-secondary">
                <IconLock size={14} className="mt-0.5 shrink-0 text-tertiary" />
                {t("runbooks.secretNote")}
              </p>
            ) : null}

            <section className="space-y-1.5" aria-label={t("runbooks.command")}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-tertiary">
                  {t("runbooks.command")}
                </h3>
                {/*
                  The button exists only when there is a complete command. A
                  disabled copy button would be a control that appears to do
                  something and cannot; the refusal below says what to fix.
                */}
                {result.ok ? (
                  <button
                    type="button"
                    className={classNames(
                      "btn-secondary",
                      copyState === "copied" && "text-success",
                      copyState === "failed" && "text-warning",
                    )}
                    onClick={copy}
                  >
                    {copyState === "copied" ? (
                      <IconCheck size={14} />
                    ) : copyState === "failed" ? (
                      <IconAlert size={14} />
                    ) : (
                      <IconClipboard size={14} />
                    )}
                    {copyState === "copied"
                      ? t("runbooks.copied")
                      : copyState === "failed"
                        ? t("runbooks.copyFailed")
                        : t("runbooks.copy")}
                  </button>
                ) : null}
              </div>
              {result.ok ? (
                <pre
                  dir="ltr"
                  className="mono max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-subtle bg-inset p-3 text-2xs text-primary [overflow-wrap:anywhere]"
                >
                  {result.command}
                </pre>
              ) : (
                <p className="rounded-md border border-danger bg-danger-subtle p-2.5 text-sm text-danger">
                  {refusal}
                </p>
              )}
              {/* The tick is the only change a sighted person sees; this is what
                  tells everybody else that the press did something. */}
              <p role="status" aria-live="polite" className="min-h-4 text-xs text-warning">
                {copyState === "failed" ? t("runbooks.copyFailedNote") : null}
              </p>
            </section>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
