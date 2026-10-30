/** About & Help: identity, build fingerprint, and reference material worth having offline. */
import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "../components/primitives";
import { Wordmark } from "../components/Wordmark";
import { useT, type MessageKey } from "../lib/i18n";
import { openAboutLink, safeInvoke, writeClipboard } from "../lib/tauri";
import { classNames, fullscreenHint, modKeyLabel } from "../lib/util";
import { useToasts } from "../state/ToastContext";

export const AUTHOR_NAME = "psmux";

type Tab = "About" | "Help";

/** The tab names are the app's own; the labels on them are translated. */
const TAB_LABEL: Record<Tab, MessageKey> = {
  About: "about.tabAbout",
  Help: "about.tabHelp",
};

/** Mirror of the Rust `AboutInfo` struct (src-tauri/src/commands/about.rs). */
interface AboutInfo {
  appVersion: string;
  gitDescribe: string;
  gitHash: string;
  gitHashShort: string;
  gitBranch: string;
  gitCommitDate: string;
  gitDirty: string;
  buildProfile: string;
  rustcVersion: string;
  tauriVersion: string;
  os: string;
  osVersion: string;
  arch: string;
  webviewVersion: string;
}

/**
 * The build stamp is compiled into the Rust binary (build.rs), so it can
 * never drift from what is actually running. Null in the plain-browser dev
 * server, where there is no runtime to ask.
 */
function useAboutInfo(): AboutInfo | null {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    void safeInvoke<AboutInfo | null>("about_info", undefined, null).then((i) => {
      if (!cancelled) setInfo(i);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

/**
 * The paste-into-an-issue block. Everything support needs to check out the
 * exact code a report came from, in the order a human scans it: what build,
 * which commit, on what machine.
 */
export function buildReport(i: AboutInfo): string {
  const dirty = i.gitDirty === "dirty" ? ", locally modified (dirty)" : "";
  return [
    "```",
    `OraxDesk ${i.appVersion} (${i.gitDescribe})`,
    `Commit:  ${i.gitHash}`,
    `         branch ${i.gitBranch}, committed ${i.gitCommitDate}${dirty}`,
    `Build:   ${i.buildProfile} profile, tauri ${i.tauriVersion}, ${i.rustcVersion}`,
    `System:  ${i.os} ${i.osVersion} (${i.arch}), webview ${i.webviewVersion}`,
    "```",
  ].join("\n");
}

const SHORTCUTS: Array<[string, MessageKey]> = [
  [`${modKeyLabel}K`, "about.shortcut.palette"],
  [`${modKeyLabel}N`, "about.shortcut.newHost"],
  [`${modKeyLabel}T`, "about.shortcut.quickConnect"],
  [`${modKeyLabel}F`, "about.shortcut.search"],
  [`${modKeyLabel},`, "about.shortcut.preferences"],
  [`${modKeyLabel}⇧D`, "about.shortcut.disconnect"],
  [`${modKeyLabel}⇧M`, "about.shortcut.toolbar"],
  // Not a ⌘-family chord on Windows and Linux: it is F11 there. See
  // `fullscreenHint`.
  [fullscreenHint, "about.shortcut.fullscreen"],
  // Tabbed view only (Preferences → Connections). Harmless to list either
  // way: with no tabs open there is nothing for them to switch to.
  ["⌃⇥ / ⌃⇧⇥", "about.shortcut.tabs"],
  [`${modKeyLabel}1…9`, "about.shortcut.jumpTab"],
  [`${modKeyLabel}⇧W`, "about.shortcut.closeTab"],
  [`${modKeyLabel}⇧L`, "about.shortcut.backToLibrary"],
  // Splitting a tab into panes. Every one carries Alt, because the plain
  // pairs already mean something and a near miss here costs a connection.
  [`${modKeyLabel}⌥D`, "about.shortcut.splitRight"],
  [`${modKeyLabel}⌥⇧D`, "about.shortcut.splitDown"],
  [`${modKeyLabel}⌥[ / ]`, "about.shortcut.prevPane"],
  [`${modKeyLabel}⌥Z`, "about.shortcut.maximise"],
  [`${modKeyLabel}⌥=`, "about.shortcut.equal"],
  [`${modKeyLabel}⌥W`, "about.shortcut.closePane"],
];

const TROUBLESHOOTING: Array<[MessageKey, MessageKey]> = [
  ["about.issue.scanMissing", "about.issue.scanMissingFix"],
  ["about.issue.retry", "about.issue.retryFix"],
  ["about.issue.keyboard", "about.issue.keyboardFix"],
  ["about.issue.passwords", "about.issue.passwordsFix"],
];

export function About({ onClose }: { onClose: () => void }): ReactNode {
  const t = useT();
  const { push } = useToasts();
  const [tab, setTab] = useState<Tab>("About");
  const info = useAboutInfo();
  const [copied, setCopied] = useState(false);

  /**
   * Open one of the two links, and say so when it does not open.
   *
   * `openAboutLink` propagates its failure (the shell really can refuse: no
   * browser, a blocked handler), and a button that silently does nothing is
   * the bug this replaces.
   */
  const openLink = (target: "project" | "contact"): void => {
    void openAboutLink(target).catch(() =>
      push("danger", t("about.openFailed")),
    );
  };

  const copyReport = (): void => {
    if (!info) return;
    void writeClipboard(buildReport(info)).then((ok) => {
      setCopied(ok);
      if (ok) window.setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <Dialog title={t("about.title")} onClose={onClose} width={560}>
      <nav className="mb-4 flex gap-1 border-b border-subtle" aria-label={t("about.sectionsLabel")}>
        {(["About", "Help"] as const).map((name) => (
          <button
            key={name}
            type="button"
            aria-current={tab === name ? "true" : undefined}
            className={classNames(
              "-mb-px border-b-2 px-3 py-1.5 text-sm",
              tab === name
                ? "border-accent font-medium text-primary"
                : "border-transparent text-secondary hover:text-primary",
            )}
            onClick={() => setTab(name)}
          >
            {t(TAB_LABEL[name])}
          </button>
        ))}
      </nav>

      {tab === "About" ? (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-3">
              <img
                src="/brand/icon-256.png"
                alt=""
                aria-hidden="true"
                className="size-11 rounded-lg"
              />
              <div>
                <h3 className="text-lg text-primary"><Wordmark /></h3>
                <p className="text-sm font-medium text-secondary">{t("brand.tagline")}</p>
              </div>
            </div>
            <p className="mt-2 text-sm text-tertiary">{t("about.tagline")}</p>
            <p className="mt-1 text-sm text-tertiary">
              {t("about.version", { version: info ? `${info.appVersion} (${info.gitDescribe})` : "-" })}
            </p>
          </div>

          {info ? (
            <section aria-label={t("about.buildLabel")}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <h4 className="text-sm font-semibold text-primary">{t("about.build")}</h4>
                <button
                  type="button"
                  className="text-xs text-accent hover:underline"
                  onClick={copyReport}
                >
                  {copied ? t("about.copied") : t("about.copyReport")}
                </button>
              </div>
              <dl className="space-y-1 rounded-md bg-inset/50 p-3 font-mono text-xs">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-tertiary">{t("about.commit")}</dt>
                  <dd className="text-primary break-all" title={info.gitHash}>
                    {info.gitHashShort}
                    {info.gitDirty === "dirty" ? ` (${t("about.locallyModified")})` : ""}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-tertiary">{t("about.branch")}</dt>
                  <dd className="text-primary">
                    {t("about.branchDetail", { branch: info.gitBranch, date: info.gitCommitDate })}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-tertiary">{t("about.toolchain")}</dt>
                  <dd className="text-primary">
                    {t("about.toolchainDetail", {
                      profile: info.buildProfile,
                      tauri: info.tauriVersion,
                      rustc: info.rustcVersion,
                    })}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-tertiary">{t("about.system")}</dt>
                  <dd className="text-primary">
                    {t("about.systemDetail", {
                      os: info.os,
                      version: info.osVersion,
                      arch: info.arch,
                      webview: info.webviewVersion,
                    })}
                  </dd>
                </div>
              </dl>
              <p className="mt-1 text-xs text-tertiary">{t("about.includeBlock")}</p>
            </section>
          ) : null}

          <dl className="space-y-2 rounded-md bg-inset/50 p-3 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-tertiary">{t("about.developedBy")}</dt>
              <dd className="text-primary">{AUTHOR_NAME}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-tertiary">{t("about.contact")}</dt>
              <dd>
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => openLink("contact")}
                >
                  {AUTHOR_NAME}
                </button>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-tertiary">{t("about.license")}</dt>
              <dd className="text-primary">MIT OR Apache-2.0</dd>
            </div>
          </dl>

          <p className="text-xs text-tertiary">
            {t("about.copyright", { year: new Date().getFullYear(), author: AUTHOR_NAME })}
          </p>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openLink("project")}
            >
              {t("about.projectPage")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openLink("contact")}
            >
              {t("about.contactDeveloper")}
            </button>
            <button type="button" className="btn-primary ms-auto" data-autofocus onClick={onClose}>
              {t("about.close")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <section>
            <h3 className="mb-1.5 text-sm font-semibold text-primary">{t("about.gettingStarted")}</h3>
            <ol className="list-inside list-decimal space-y-1 text-sm text-secondary">
              <li>
                {t("about.startUse")}{" "}
                <strong className="text-primary">{t("about.scanNetwork")}</strong>{" "}
                {t("about.startFind")}{" "}
                <strong className="text-primary">{t("about.newHost")}</strong>{" "}
                {t("about.startAdd")}
              </li>
              <li>{t("about.startConnect")}</li>
              <li>{t("about.startOrganise")}</li>
            </ol>
          </section>

          <section>
            <h3 className="mb-1.5 text-sm font-semibold text-primary">{t("about.shortcuts")}</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-baseline gap-2">
                  <dt className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-xs text-primary">
                    {keys}
                  </dt>
                  <dd className="text-secondary">{t(what)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3 className="mb-1.5 text-sm font-semibold text-primary">{t("about.troubleshooting")}</h3>
            <dl className="space-y-2 text-sm">
              {TROUBLESHOOTING.map(([symptom, fix]) => (
                <div key={symptom}>
                  <dt className="text-primary">{t(symptom)}</dt>
                  <dd className="text-secondary">{t(fix)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openLink("project")}
            >
              {t("about.documentation")}
            </button>
            <button type="button" className="btn-primary ms-auto" onClick={onClose}>
              {t("about.close")}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
