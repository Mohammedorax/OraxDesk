/** Preferences: sidebar-tabbed, every setting with a one-line description (PRD/11 §3.4). */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { useSettings, type LocalCursor, type ThemeChoice } from "../state/SettingsContext";
import { useLivePreviews } from "../state/SessionsContext";
import { ALLOW_MULTIPLE_SESSIONS_KEY, safeInvoke } from "../lib/tauri";
import {
  PREF_CLIPBOARD_AUTO,
  PREF_CLIPBOARD_ON_FOCUS,
  PREF_CLIPBOARD_ON_PASTE,
  PREF_EDGE_PAN,
  PREF_FORWARD_INSERTED_TEXT,
  PREF_TYPE_LOCAL_PASTE,
  PREF_HIDE_AGENT_STATUS,
  PREF_HIDE_TOOLBAR,
  PREF_MATCH_LOCAL_LAYOUT,
  PREF_NATURAL_SCROLL,
  PREF_ZOOM_LOCKED,
  readBoolPref,
  writeBoolPref,
} from "../lib/prefs";
import { useAgentActivity } from "../state/AgentActivityContext";
import { planeStatusLine } from "../lib/agentActivity";
import { useT, useLang, type MessageKey } from "../lib/i18n";
import { readViewDefaults, writeViewDefaults, type ViewPrefs } from "../lib/viewPrefs";
import type { QualityPreset, ScalingMode } from "../lib/types";
import type { RdpResolution } from "../lib/rdp";
import { RDP_FIXED_SIZES } from "../lib/rdp";
import {
  decodeResolution,
  encodeResolution,
  RDP_DEFAULT_KEYS,
  setRdpDefault,
} from "../lib/rdpDefaults";
import { classNames } from "../lib/util";
import { radioMove } from "../lib/radioGroup";
import { IconX } from "../components/icons";
import { Select } from "../components/primitives";

const TABS = [
  "General", "Appearance", "Connections", "Session", "Input", "Clipboard", "Security", "Network", "Agents",
] as const;
type Tab = (typeof TABS)[number];

/** Fixed order: the arrow keys walk this list, not whatever the DOM holds. */
const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/**
 * The name of each tab, in the app's language.
 *
 * The tab ids stay English because they are compared, never read: what a
 * person sees comes from the catalogue, so a tab is named in Arabic in an
 * Arabic app and in English in an English one.
 */
const TAB_LABELS: Record<Tab, MessageKey> = {
  General: "prefs.tabGeneral",
  Appearance: "prefs.tabAppearance",
  Connections: "prefs.tabConnections",
  Session: "prefs.tabSession",
  Input: "prefs.tabInput",
  Clipboard: "prefs.tabClipboard",
  Security: "prefs.tabSecurity",
  Network: "prefs.tabNetwork",
  Agents: "prefs.tabAgents",
};

/**
 * Tabs that only exist when there is something behind them.
 *
 * "Agents" is the only one, and it is here rather than always on because
 * `AGENT_BRIEF` D2 means an install with the plane switched off has to look
 * exactly as it did before the feature was written, Preferences included. The
 * way in with the plane off is the AI Agents button in the library sidebar,
 * which exists in both states on purpose.
 */
function tabsFor(planeOn: boolean): readonly Tab[] {
  return planeOn ? TABS : TABS.filter((t) => t !== "Agents");
}

/**
 * localStorage-backed preference (until the backend settings store lands).
 *
 * Storage goes through `lib/prefs`, which is also what the code acting on
 * these preferences reads. Anything that writes a key here by hand is a
 * preference nothing can consult.
 */
function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => readBoolPref(key, initial));
  useEffect(() => {
    writeBoolPref(key, v);
  }, [key, v]);
  return [v, setV];
}


/**
 * The starting point for a computer nothing has been adjusted on.
 *
 * These are not live settings: changing one here reaches the computers you
 * have never touched these options on, and leaves alone the ones you have,
 * because a choice made while looking at a particular desktop is about that
 * desktop. See `lib/viewPrefs`.
 */
function useViewDefaults(): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
  const [value, setValue] = useState<ViewPrefs>(readViewDefaults);
  const set = useCallback((patch: Partial<ViewPrefs>) => {
    setValue(writeViewDefaults(patch));
  }, []);
  return [value, set];
}

/**
 * A preference that lives in the Rust store rather than localStorage, because
 * the backend has to consult it while building a connection (the webview is
 * not involved at that point).
 */
function useAppSetting(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(initial);
  useEffect(() => {
    let cancelled = false;
    void safeInvoke<string | null>("get_app_setting", { key }, null).then((raw) => {
      if (!cancelled && raw !== null && raw !== undefined) setV(raw !== "false");
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  const set = useCallback(
    (next: boolean) => {
      setV(next);
      void safeInvoke("set_app_setting", { key, value: next ? "true" : "false" }, null);
    },
    [key],
  );
  return [v, set];
}

/**
 * The resolution a new Remote Desktop host starts with.
 *
 * `useAppSetting` only carries booleans and this is a choice of several, so it
 * gets its own reader. It writes through the in-memory cache as well as the
 * store, so a host added straight after changing this picks it up without a
 * restart.
 */
function useRdpResolutionDefault(): [RdpResolution, (v: RdpResolution) => void] {
  const [v, setV] = useState<RdpResolution>({ mode: "window-at-connect" });
  useEffect(() => {
    let cancelled = false;
    void safeInvoke<string | null>(
      "get_app_setting",
      { key: RDP_DEFAULT_KEYS.resolution },
      null,
    ).then((raw) => {
      const parsed = decodeResolution(raw);
      if (!cancelled && parsed) setV(parsed);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const set = useCallback((next: RdpResolution) => {
    setV(next);
    setRdpDefault("resolution", next);
    void safeInvoke(
      "set_app_setting",
      { key: RDP_DEFAULT_KEYS.resolution, value: encodeResolution(next) },
      null,
    );
  }, []);
  return [v, set];
}

export function Preferences({ onClose }: { onClose: () => void }): ReactNode {
  const [tab, setTab] = useState<Tab>("General");
  const { settings, update } = useSettings();
  // The same toggle as the Library header, one source of truth, and flipping
  // it here broadcasts to session windows exactly the same way.
  const { livePreviews, setLivePreviews } = useLivePreviews();
  const [credBackend, setCredBackend] = useState<string | null>(null);

  const [naturalScroll, setNaturalScroll] = usePref(PREF_NATURAL_SCROLL, true);
  const [matchLocalLayout, setMatchLocalLayout] = usePref(PREF_MATCH_LOCAL_LAYOUT, false);
  // Store-backed (not localStorage): Rust reads these at connect time.
  const [losslessRefresh, setLosslessRefresh] = useAppSetting("lossless_refresh", true);
  const [deepNames, setDeepNames] = useAppSetting("probe_other_services", true);
  const [probeRdp, setProbeRdp] = useAppSetting("probe_rdp", true);
  // Defaults for NEW Remote Desktop hosts. They live in the Rust key-value
  // table rather than the webview so the connect path can read them later
  // without a round trip through JS.
  const [rdpMultiMonitor, setRdpMultiMonitor] = useAppSetting("rdp_default_multi_monitor", false);
  const [rdpResolution, setRdpResolution] = useRdpResolutionDefault();
  const [rdpAudio, setRdpAudio] = useAppSetting("rdp_default_audio", true);
  const [rdpClipboard, setRdpClipboard] = useAppSetting("rdp_default_redirect_clipboard", true);
  const [multipleSessions, setMultipleSessions] = useAppSetting(ALLOW_MULTIPLE_SESSIONS_KEY, false);
  const [clipboardAuto, setClipboardAuto] = usePref(PREF_CLIPBOARD_AUTO, true);
  const [clipboardOnFocus, setClipboardOnFocus] = usePref(PREF_CLIPBOARD_ON_FOCUS, true);
  const [clipboardOnPaste, setClipboardOnPaste] = usePref(PREF_CLIPBOARD_ON_PASTE, true);
  const [forwardInsertedText, setForwardInsertedText] = usePref(PREF_FORWARD_INSERTED_TEXT, true);
  const [typeLocalPaste, setTypeLocalPaste] = usePref(PREF_TYPE_LOCAL_PASTE, true);
  const [hideToolbar, setHideToolbar] = usePref(PREF_HIDE_TOOLBAR, false);
  const [zoomLocked, setZoomLocked] = usePref(PREF_ZOOM_LOCKED, false);
  const [edgePan, setEdgePan] = usePref(PREF_EDGE_PAN, true);
  const [hideAgentStatus, setHideAgentStatus] = usePref(PREF_HIDE_AGENT_STATUS, false);
  const [viewDefaults, setViewDefaults] = useViewDefaults();
  // The plane, read for two things only: whether the Agents tab exists at all,
  // and the live line the toggle below is about.
  const { plane } = useAgentActivity();
  const t = useT();
  const lang = useLang();
  const themeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = tabsFor(plane.on);

  useEffect(() => {
    void safeInvoke<string | null>("credential_backend", undefined, null).then(setCredBackend);
  }, []);

  // Somebody reading this tab while the plane is switched off from elsewhere
  // would be left looking at a section that is no longer listed.
  useEffect(() => {
    if (!plane.on && tab === "Agents") setTab("General");
  }, [plane.on, tab]);

  // Escape closes, like every other modal in the app (the X was the only way out).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fade-in fixed inset-0 z-40 flex items-center justify-center bg-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("prefs.title")}
        className="flex h-[560px] w-[760px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-subtle bg-surface shadow-(--shadow-pop)"
      >
        <nav className="w-44 shrink-0 space-y-0.5 border-r border-subtle bg-inset/40 p-2.5" aria-label={t("prefs.sectionsAria")}>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "true" : undefined}
              className={classNames(
                "block w-full rounded-sm px-2.5 py-1.5 text-start text-sm",
                tab === id ? "bg-accent/15 font-medium text-primary" : "text-secondary hover:bg-inset",
              )}
              onClick={() => setTab(id)}
            >
              {t(TAB_LABELS[id])}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-subtle px-5 py-3">
            <h2 className="text-base font-semibold text-primary">{t(TAB_LABELS[tab])}</h2>
            <LanguageSwitch />
            <button type="button" aria-label={t("prefs.closeAria")} className="rounded-sm p-1 text-tertiary hover:text-primary" onClick={onClose}>
              <IconX size={16} />
            </button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {tab === "General" ? (
              <>
                <Toggle
                  label={t("library.livePreviews")}
                  description={t("prefs.livePreviewsHint")}
                  value={livePreviews}
                  onChange={setLivePreviews}
                />
                <Toggle
                  label={t("prefs.compactDensity")}
                  description={t("prefs.compactDensityHint")}
                  value={settings.compact}
                  onChange={(v) => update({ compact: v })}
                />
              </>
            ) : null}
            {tab === "Appearance" ? (
              <>
                <div>
                  <p className="text-sm font-medium text-primary">{t("prefs.theme")}</p>
                  <p className="mb-2 text-xs text-tertiary">{t("prefs.themeHint")}</p>
                  <div className="flex gap-2" role="radiogroup" aria-label={t("prefs.theme")}>
                    {THEME_CHOICES.map((choice, i) => (
                      <button
                        key={choice}
                        ref={(el) => {
                          themeRefs.current[i] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={settings.theme === choice}
                        tabIndex={settings.theme === choice ? 0 : -1}
                        className={classNames(
                          "rounded-md border px-4 py-2 text-sm capitalize",
                          settings.theme === choice
                            ? "border-accent bg-accent/10 font-medium text-primary"
                            : "border-subtle text-secondary hover:border-strong",
                        )}
                        onClick={() => update({ theme: choice })}
                        onKeyDown={(e) => {
                          const next = radioMove(
                            e.key,
                            i,
                            THEME_CHOICES.length,
                            lang === "ar" ? "rtl" : "ltr",
                          );
                          if (next === null) return;
                          e.preventDefault();
                          update({ theme: THEME_CHOICES[next] });
                          themeRefs.current[next]?.focus();
                        }}
                      >
                        {choice === "system"
                          ? t("prefs.themeSystem")
                          : choice === "light"
                            ? t("prefs.themeLight")
                            : t("prefs.themeDark")}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            {tab === "Connections" ? (
              <>
                <Toggle
                  label={t("prefs.tabsInOneWindow")}
                  description={t("prefs.tabsInOneWindowHint")}
                  value={settings.windowMode === "tabs"}
                  onChange={(v) => update({ windowMode: v ? "tabs" : "windows" })}
                />
                <Toggle
                  label={
                    settings.windowMode === "tabs"
                      ? t("prefs.multipleTabs")
                      : t("prefs.multipleWindows")
                  }
                  description={
                    settings.windowMode === "tabs"
                      ? t("prefs.multipleTabsHint")
                      : t("prefs.multipleWindowsHint")
                  }
                  value={multipleSessions}
                  onChange={setMultipleSessions}
                />
                <Toggle
                  label={t("prefs.sharpenOnStop")}
                  description={t("prefs.sharpenOnStopHint")}
                  value={losslessRefresh}
                  onChange={setLosslessRefresh}
                />
                {/*
                  Defaults for new Remote Desktop hosts, not a switch that
                  reaches into existing ones. There is deliberately nothing
                  here about network level authentication or legacy TLS: those
                  are per host, off by default, and a global switch would let
                  one bad server quietly lower the bar for every other one.
                */}
                <SectionHeading>{t("prefs.rdpDefaults")}</SectionHeading>
                <Toggle
                  label={t("prefs.allMonitors")}
                  description={t("prefs.allMonitorsHint")}
                  value={rdpMultiMonitor}
                  onChange={(on) => {
                    setRdpDefault("monitors", on ? "all" : "primary");
                    setRdpMultiMonitor(on);
                  }}
                />
                <label className="block">
                  <span className="text-sm text-primary">{t("prefs.resolutionForNew")}</span>
                  <span className="mt-0.5 block text-xs text-tertiary">
                    {t("prefs.resolutionForNewHint")}
                  </span>
                  <Select
                    className="mt-1.5"
                    value={encodeResolution(rdpResolution)}
                    onChange={(e) => {
                      const next = decodeResolution(e.target.value);
                      if (next) setRdpResolution(next);
                    }}
                  >
                    <option value="window-at-connect">{t("host.resolutionAtConnect")}</option>
                    <option value="follow-window">{t("host.resolutionFollow")}</option>
                    {RDP_FIXED_SIZES.map(([w, h]) => (
                      <option key={`${w}x${h}`} value={`${w}x${h}`}>
                        {w} x {h}
                      </option>
                    ))}
                  </Select>
                </label>
                <Toggle
                  label={t("prefs.playRemoteSound")}
                  description={t("prefs.playRemoteSoundHint")}
                  value={rdpAudio}
                  onChange={(on) => {
                    setRdpDefault("audio", on ? "play-locally" : "leave-at-server");
                    setRdpAudio(on);
                  }}
                />
                <Toggle
                  label={t("prefs.shareClipboardRdp")}
                  description={t("prefs.shareClipboardRdpHint")}
                  value={rdpClipboard}
                  onChange={(on) => {
                    setRdpDefault("clipboard", on);
                    setRdpClipboard(on);
                  }}
                />
              </>
            ) : null}
            {tab === "Session" ? (
              <>
                <Toggle
                  label={t("prefs.hideToolbar")}
                  description={t("prefs.hideToolbarHint")}
                  value={hideToolbar}
                  onChange={setHideToolbar}
                />
                <Toggle
                  label={t("session.lockZoom")}
                  description={t("prefs.zoomLockedHint")}
                  value={zoomLocked}
                  onChange={setZoomLocked}
                />
                <Toggle
                  label={t("session.panByEdges")}
                  description={t("prefs.edgePanHint")}
                  value={edgePan}
                  onChange={setEdgePan}
                />

                <div className="border-t border-subtle pt-5">
                  <p className="text-sm font-medium text-primary">{t("prefs.newDefaults")}</p>
                  <p className="mt-0.5 text-xs text-tertiary">
                    {t("prefs.newDefaultsHint")}
                  </p>
                </div>

                <Choice
                  label={t("host.scaling")}
                  description={t("prefs.scalingHint")}
                  value={viewDefaults.scalingMode}
                  options={
                    [
                      ["aspect-fit", t("host.scalingAspectFit")],
                      ["fit", t("host.scalingFit")],
                      ["actual", t("host.scalingActual")],
                      ["remote-resize", t("host.scalingRemoteResize")],
                    ] as [ScalingMode, string][]
                  }
                  onChange={(scalingMode) => setViewDefaults({ scalingMode })}
                />
                <Choice
                  label={t("host.quality")}
                  description={t("prefs.qualityHint")}
                  value={viewDefaults.quality}
                  options={
                    [
                      ["auto", t("host.auto")],
                      ["high", t("prefs.qualityHigh")],
                      ["medium", t("prefs.qualityMedium")],
                      ["low", t("prefs.qualityLow")],
                      ["bw", t("host.qualityBw")],
                    ] as [QualityPreset, string][]
                  }
                  onChange={(quality) => setViewDefaults({ quality })}
                />
                {viewDefaults.quality === "bw" ? (
                  <Choice
                    label={t("session.grayLevels")}
                    description={t("prefs.grayLevelsHint")}
                    value={String(viewDefaults.bwLevels)}
                    options={[
                      ["256", "256"],
                      ["16", "16"],
                      ["8", "8"],
                      ["4", "4"],
                      ["2", "2"],
                      ["1", t("session.oneBit")],
                    ]}
                    onChange={(v) => setViewDefaults({ bwLevels: Number(v) })}
                  />
                ) : null}
                <Toggle
                  label={t("prefs.viewOnly")}
                  description={t("prefs.viewOnlyHint")}
                  value={viewDefaults.viewOnly}
                  onChange={(viewOnly) => setViewDefaults({ viewOnly })}
                />
                <Toggle
                  label={t("session.alwaysFresh")}
                  description={t("session.alwaysFreshHint")}
                  value={viewDefaults.alwaysRefresh}
                  onChange={(alwaysRefresh) => setViewDefaults({ alwaysRefresh })}
                />
                <Toggle
                  label={t("session.passShortcuts")}
                  description={t("prefs.passShortcutsHint")}
                  value={viewDefaults.passthrough}
                  onChange={(passthrough) => setViewDefaults({ passthrough })}
                />
              </>
            ) : null}
            {tab === "Input" ? (
              <>
                <Toggle
                  label={t("prefs.matchScroll")}
                  description={t("prefs.matchScrollHint")}
                  value={naturalScroll}
                  onChange={setNaturalScroll}
                />
                <Toggle
                  label={t("prefs.matchKeyboard")}
                  description={t("prefs.matchKeyboardHint")}
                  value={matchLocalLayout}
                  onChange={setMatchLocalLayout}
                />
                <Toggle
                  label={t("prefs.typeDictation")}
                  description={t("prefs.typeDictationHint")}
                  value={forwardInsertedText}
                  onChange={setForwardInsertedText}
                />
                <Toggle
                  label={t("prefs.typeLocalPaste")}
                  description={t("prefs.typeLocalPasteHint")}
                  value={typeLocalPaste}
                  onChange={setTypeLocalPaste}
                />
                <Toggle
                  label={t("session.showRemotePointer")}
                  description={t("prefs.showRemotePointerHint")}
                  value={settings.showRemoteCursor}
                  onChange={(v) => update({ showRemoteCursor: v })}
                />
                <Choice
                  label={t("session.myPointer")}
                  description={t("prefs.pointerHint")}
                  value={settings.localCursor}
                  options={
                    [
                      ["standard", t("session.cursorStandard")],
                      ["dot", t("session.cursorDot")],
                      ["off", t("session.cursorHidden")],
                    ] as [LocalCursor, string][]
                  }
                  onChange={(localCursor) => update({ localCursor })}
                />
              </>
            ) : null}
            {tab === "Clipboard" ? (
              <>
                <Toggle
                  label={t("prefs.clipboardSync")}
                  description={t("prefs.clipboardSyncHint")}
                  value={clipboardAuto}
                  onChange={setClipboardAuto}
                />
                <Toggle
                  label={t("prefs.clipboardOnFocus")}
                  description={t("prefs.clipboardOnFocusHint")}
                  value={clipboardOnFocus}
                  onChange={setClipboardOnFocus}
                />
                <Toggle
                  label={t("prefs.clipboardOnPaste")}
                  description={t("prefs.clipboardOnPasteHint")}
                  value={clipboardOnPaste}
                  onChange={setClipboardOnPaste}
                />
              </>
            ) : null}
            {tab === "Security" ? (
              <>
                <div>
                  <p className="text-sm font-medium text-primary">{t("prefs.credentialStorage")}</p>
                  <p className="text-xs text-tertiary">
                    {credBackend
                      ? t("prefs.credentialsIn", { backend: credBackend })
                      : t("prefs.credentialsKeychain")}
                  </p>
                </div>
              </>
            ) : null}
            {tab === "Network" ? (
              <>
                <Toggle
                  label={t("prefs.deepNames")}
                  description={t("prefs.deepNamesHint")}
                  value={deepNames}
                  onChange={setDeepNames}
                />
                <Toggle
                  label={t("prefs.probeRdp")}
                  description={t("prefs.probeRdpHint")}
                  value={probeRdp}
                  onChange={setProbeRdp}
                />
              </>
            ) : null}
            {tab === "Agents" && plane.on ? (
              <>
                <Toggle
                  label={t("prefs.hideAgentCounts")}
                  description={t("prefs.hideAgentCountsHint")}
                  value={hideAgentStatus}
                  onChange={setHideAgentStatus}
                />
                <div className="border-t border-subtle pt-5">
                  <p className="text-sm font-medium text-primary">{t("prefs.rightNow")}</p>
                  {/*
                    The same sentence the strip draws, from the same function.
                    A person deciding whether to hide something should be able
                    to see what they are hiding.
                  */}
                  <p className="mono mt-0.5 text-xs text-secondary">{planeStatusLine(plane, t)}</p>
                  <p className="mt-1.5 text-xs text-tertiary">
                    {t("prefs.rightNowHint")}
                  </p>
                </div>
                <p className="text-xs text-tertiary">
                  {t("prefs.agentsSidebarNote")}
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One of several, laid out like the theme picker.
 *
 * Buttons rather than a `<select>`: the lists here are short and the whole
 * point of a defaults page is being able to see what the choices are without
 * opening anything.
 */
function Choice<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}): ReactNode {
  const lang = useLang();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div>
      <p className="text-sm font-medium text-primary">{label}</p>
      <p className="mb-2 text-xs text-tertiary">{description}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map(([key, text], i) => (
          <button
            key={key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === key}
            tabIndex={value === key ? 0 : -1}
            className={classNames(
              "rounded-md border px-3.5 py-1.5 text-sm",
              value === key
                ? "border-accent bg-accent/10 font-medium text-primary"
                : "border-subtle text-secondary hover:border-strong",
            )}
            onClick={() => onChange(key)}
            onKeyDown={(e) => {
              const next = radioMove(e.key, i, options.length, lang === "ar" ? "rtl" : "ltr");
              if (next === null) return;
              e.preventDefault();
              onChange(options[next][0]);
              refs.current[next]?.focus();
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A quiet divider heading for a group of related toggles. */
function SectionHeading({ children }: { children: ReactNode }): ReactNode {
  return (
    <p className="border-t border-subtle pt-4 text-2xs font-semibold uppercase tracking-wider text-tertiary">
      {children}
    </p>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}): ReactNode {
  return (
    <label className="flex items-start justify-between gap-6">
      <span>
        <span className="block text-sm font-medium text-primary">{label}</span>
        <span className="block text-xs text-tertiary">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={classNames(
          // p-0 matters: a <button> carries default padding, and the knob below
          // is positioned from its *static* position, that padding was pushing
          // the dot past the right edge of the track.
          "relative mt-0.5 box-border h-5 w-9 shrink-0 rounded-pill p-0 transition-colors",
          value ? "bg-accent" : "bg-inset border border-subtle",
        )}
        onClick={() => onChange(!value)}
      >
        <span
          className={classNames(
            // Anchored with an explicit left/top so the knob can never depend
            // on inherited padding or the border the "off" state adds.
            "absolute start-0.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-transform",
            value ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    </label>
  );
}
