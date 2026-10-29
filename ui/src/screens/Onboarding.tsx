/** Onboarding: 3 lightweight skippable steps, no account, ends in live discovery (PRD/11 §5). */
import { useState, type ReactNode } from "react";
import { useSettings, type ThemeChoice } from "../state/SettingsContext";
import { useDiscovery } from "../state/DiscoveryContext";
import { classNames } from "../lib/util";
import { useT } from "../lib/i18n";
import { IconMonitor, IconZap, IconLock } from "../components/icons";

export function Onboarding({
  onDone,
  onAddDiscovered,
}: {
  onDone: () => void;
  onAddDiscovered: (id: string) => void;
}): ReactNode {
  const t = useT();
  const [step, setStep] = useState(0);
  const { settings, update } = useSettings();
  const { discovered, scan, startScan } = useDiscovery();
  const [ranDiscovery, setRanDiscovery] = useState(false);
  /**
   * Why the scan could not be started, or null when it could.
   *
   * "Nothing found yet" and "the scan never ran" are different sentences, and
   * the second one is the truthful one when the command failed: a panel that
   * says nothing was found after a scan that never started is telling the
   * person their network is empty when what is empty is the search.
   */
  const [scanError, setScanError] = useState("");

  const finish = (): void => {
    update({ onboarded: true });
    onDone();
  };

  /**
   * Start the search, and remember that it could not be started.
   *
   * The context resets the scan state itself when the command fails, so the
   * spinner stops. The failure is not swallowed: it is held in state and
   * shown in the panel below, because this screen has no toast of its own
   * and a panel that says "nothing found" after a scan that never ran is a
   * lie about the network.
   */
  const runScan = (): void => {
    setRanDiscovery(true);
    setScanError("");
    void startScan().catch((err: unknown) => {
      console.error("[onboarding] the network scan could not be started:", err);
      setScanError(t("onboarding.scanFailed"));
    });
  };

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="w-[520px] max-w-full rounded-lg border border-subtle bg-surface p-8 shadow-(--shadow-pop)">
        {/* progress */}
        <div className="mb-6 flex items-center gap-2" aria-label={t("onboarding.stepAria", { step: step + 1, total: 3 })}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={classNames(
                "h-1 flex-1 rounded-pill",
                i <= step ? "bg-accent" : "bg-inset",
              )}
            />
          ))}
        </div>

        {step === 0 ? (
          <div className="space-y-5">
            <div className="flex justify-center">
              <img
                src="/brand/icon-256.png"
                alt=""
                aria-hidden="true"
                className="size-16 rounded-xl"
              />
            </div>
            <h1 className="text-center text-xl font-semibold text-primary">{t("onboarding.welcome")}</h1>
            <p className="text-center text-sm text-secondary">{t("onboarding.tagline")}</p>
            <div>
              <p className="mb-2 text-xs font-medium text-secondary">{t("onboarding.appearance")}</p>
              <div className="flex gap-2" role="radiogroup" aria-label={t("onboarding.themeAria")}>
                {(["system", "light", "dark"] as ThemeChoice[]).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    role="radio"
                    aria-checked={settings.theme === theme}
                    className={classNames(
                      "flex-1 rounded-md border px-3 py-2 text-sm capitalize",
                      settings.theme === theme
                        ? "border-accent bg-accent/10 font-medium text-primary"
                        : "border-subtle text-secondary hover:border-strong",
                    )}
                    onClick={() => update({ theme })}
                  >
                    {theme === "system" ? t("onboarding.themeSystem") : theme}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-5">
            <div className="flex justify-center text-accent">
              <IconZap size={56} />
            </div>
            <h1 className="text-center text-xl font-semibold text-primary">{t("onboarding.findComputers")}</h1>
            <p className="text-center text-sm text-secondary">
              {t("onboarding.scanHint")}
            </p>
            {!ranDiscovery ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={runScan}
                >
                  <IconZap size={14} /> {t("library.findOnNetwork")}
                </button>
              </div>
            ) : (
              <div className="rounded-md border border-subtle bg-inset/50 p-3">
                {scan.running ? (
                  <div className="mb-2 overflow-hidden rounded-pill bg-inset">
                    <div className="indeterminate-bar h-0.5 w-1/3 bg-accent" />
                  </div>
                ) : null}
                {scanError !== "" ? (
                  <>
                    <p role="alert" className="text-center text-xs text-danger">
                      {scanError}
                    </p>
                    {/*
                      A way back. The scan button is gone once it has been
                      pressed, so a failure with nothing to press left the
                      person looking at an error they could not act on.
                    */}
                    <div className="mt-2 flex justify-center">
                      <button type="button" className="btn-secondary" onClick={runScan}>
                        <IconZap size={14} /> {t("onboarding.scanRetry")}
                      </button>
                    </div>
                  </>
                ) : discovered.length === 0 ? (
                  <p className="text-center text-xs text-tertiary">
                    {scan.running ? t("onboarding.scanning") : t("onboarding.scanNothing")}
                  </p>
                ) : (
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {discovered.map((d) => (
                      <li key={d.id} className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm text-primary">
                        <IconMonitor size={15} className="text-tertiary" />
                        <span className="flex-1 truncate">{d.name}</span>
                        <span className="mono text-xs text-tertiary">{d.address}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-5">
            <div className="flex justify-center text-accent">
              <IconLock size={56} />
            </div>
            <h1 className="text-center text-xl font-semibold text-primary">{t("onboarding.saveFirst")}</h1>
            <p className="text-center text-sm text-secondary">
              {t("onboarding.saveHint")}
            </p>
            {discovered.length > 0 ? (
              <ul className="space-y-1.5">
                {discovered.slice(0, 4).map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-md border border-subtle px-3 py-2 text-start text-sm text-primary hover:border-accent"
                      onClick={() => {
                        update({ onboarded: true });
                        onAddDiscovered(d.id);
                      }}
                    >
                      <IconMonitor size={16} className="text-tertiary" />
                      <span className="flex-1 truncate">{d.name}</span>
                      <span className="mono text-xs text-tertiary">{d.address}</span>
                      <span className="text-xs font-medium text-accent">{t("onboarding.saveLabel")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center text-xs text-tertiary">
                {t("onboarding.noDiscovered")}
              </p>
            )}
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between">
          <button type="button" className="text-sm text-tertiary hover:text-primary" onClick={finish}>
            {t("onboarding.skip")}
          </button>
          <div className="flex gap-2.5">
            {step > 0 ? (
              <button type="button" className="btn-secondary" onClick={() => setStep((s) => s - 1)}>
                {t("onboarding.back")}
              </button>
            ) : null}
            {step < 2 ? (
              <button type="button" data-autofocus className="btn-primary" onClick={() => setStep((s) => s + 1)}>
                {t("onboarding.continue")}
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={finish}>
                {t("onboarding.openLibrary")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
