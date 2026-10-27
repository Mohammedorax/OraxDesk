import { useEffect, useRef, useState } from "react";
import { BoundaryProviderSetup } from "./BoundaryProviderSetup";
import { Dialog } from "./primitives";
import { mustInvoke, openSessionWindow, readClipboard } from "../lib/tauri";
import { rememberRegistryUrl, rememberedRegistryUrl, registry } from "../lib/support";
import { classNames, describeError } from "../lib/util";
import { useI18n } from "../lib/i18n";
import { useHosts } from "../state/HostsContext";

const NAME_KEY = "deskvnc.boundary.helperName";

/**
 * The two ways into the support window: to somebody who asked for help, and
 * to a computer that can be reached unattended.
 */
type Mode = "invite" | "machine";

/** Read a remembered value, tolerating storage that is blocked. */
function remembered(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window or blocked storage: the name is asked for again.
  }
}

/** A machine ID: 64 hex characters, as OraxDesk Support shows it. */
function looksLikeMachineId(text: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(text.trim());
}

/**
 * A computer's nine-digit number, the short one a person reads out.
 *
 * The number and the ID are two ways of naming the same computer, and the
 * field takes either, so the check has to recognise both before it complains
 * that what was typed is neither.
 */
function looksLikeNumber(text: string): boolean {
  const digits = text.trim().replaceAll(" ", "");
  return /^\d{9}$/.test(digits);
}

/**
 * Help someone: connecting to a person who asked for help, both ways in.
 *
 * Help someone now: the person presses Get help in OraxDesk, or opens
 * OraxDesk Support, presses Get a code or Create
 * invitation and sends it; it is pasted here for you when it is already on the
 * clipboard. Connect to a computer: a machine with unattended access, by its
 * ID, saved to the Library so it opens like any other computer afterwards.
 * Rust validates and owns the invitation; it never enters a URL.
 */
export function BoundaryConnect() {
  const { t, dir } = useI18n();
  const { saveHost, savePassword } = useHosts();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("invite");
  const [invitation, setInvitation] = useState("");
  const [codeService, setCodeService] = useState("");
  const [registryUrl, setRegistryUrl] = useState(rememberedRegistryUrl());
  const [name, setName] = useState(remembered(NAME_KEY));
  const [machineId, setMachineId] = useState("");
  const [machineName, setMachineName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState(false);
  /**
   * The two mode tabs, so the arrow keys can put the focus on the one they
   * move to. See the tab list below.
   */
  const tabRefs = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void registry
      .origin()
      .then((url) => {
        if (!alive || url === "") return;
        setRegistryUrl(url);
        void rememberRegistryUrl(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  const reset = () => {
    setOpen(false);
    setInvitation("");
    setMachineId("");
    setMachineName("");
    setPassword("");
    setError("");
    setPasted(false);
  };
  const close = () => {
    reset();
  };
  const show = async () => {
    setOpen(true);
    // An invitation already copied is pasted for you, and a machine ID
    // switches to connecting by ID. Nothing else on the clipboard is touched.
    const clip = (await readClipboard())?.trim() ?? "";
    if (clip.startsWith("boundary1:")) {
      setMode("invite");
      setInvitation(clip);
      setPasted(true);
    } else if (looksLikeMachineId(clip)) {
      setMode("machine");
      setMachineId(clip);
      setPasted(true);
    }
  };

  const connectInvite = async () => {
    remember(NAME_KEY, name.trim());
    const typed = invitation.trim();
    // A number is resolved through the registry when one is configured, and
    // through the shared code service otherwise. A full invitation is used as
    // it is: no lookup either way.
    let resolved = typed;
    const url = registryUrl.trim();
    if (/^[0-9\s-]+$/.test(typed)) {
      // A bare number is NOT an invitation, and sending it as one made the
      // backend answer with something nobody could act on. The machine mode
      // already refuses a number with no registry to look it up in, and this
      // is the same refusal: say what is missing instead of asking the far
      // side to make sense of digits.
      if (url === "") throw new Error(t("support.registryUrlRequired"));
      await rememberRegistryUrl(url);
      resolved = await registry.resolveCode(url, typed);
    }
    await mustInvoke("connect_boundary", {
      invitation: resolved,
      helperName: name.trim(),
      codeService: codeService.trim() || null,
    });
  };
  const connectMachine = async () => {
    remember(NAME_KEY, name.trim());
    // A nine-digit number is resolved to the device id through the registry, so
    // a person can read the number off their screen instead of copying an id.
    let target = machineId.trim().toLowerCase();
    const number = target.replace(/[\s.-]/g, "");
    if (/^[\d\s.-]+$/.test(target) && /^\d{9}$/.test(number)) {
      const url = registryUrl.trim();
      if (url === "") throw new Error(t("support.registryUrlRequired"));
      await rememberRegistryUrl(url);
      let record: { id: string };
      try {
        record = await registry.lookupNumber(url, number);
      } catch (err) {
        // The usual reason is that the other computer has not registered with
        // this registry, which is a different thing from a wrong number and
        // one the person reading the screen can fix.
        throw new Error(t("support.numberNotRegistered"));
      }
      target = record.id;
    }
    const saved = await saveHost({
      // The fallback name is a NAME the person will read in their own library
      // for ever, so it is a sentence in the app's language and not an
      // English string left in an Arabic list.
      friendlyName: machineName.trim() || t("support.defaultMachineName"),
      address: target,
      port: 0,
      protocol: "boundary",
    });
    if (!saved) throw new Error(t("support.saveMachineFailed"));
    if (password) await savePassword(saved.id, password);
    await openSessionWindow({ profileId: saved.id });
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (mode === "invite") await connectInvite();
      else await connectMachine();
      close();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const numeric = mode === "invite" && invitation.trim() !== "" && /^[0-9\s-]+$/.test(invitation.trim());
  const ready =
    name.trim() !== "" &&
    (mode === "invite"
      ? invitation.trim() !== ""
      : looksLikeMachineId(machineId) ||
        (/^[\d\s.-]+$/.test(machineId.trim()) &&
          /^\d{9}$/.test(machineId.replace(/[\s.-]/g, "")) &&
          registryUrl.trim() !== ""));

  /**
   * The two ways in, as a tab list.
   *
   * They were two plain buttons, so nothing said which one was in force: a
   * screen reader announced "Help someone now, button" and "A computer I can
   * reach, button" and left the person to work out which half of the form
   * they were looking at. The tab pattern is the one that fits two mutually
   * exclusive modes of the same form, and it says so out loud.
   *
   * The panel is ONE element that both tabs point at, and it is labelled by
   * whichever tab is in force. Only the panel that is in front is rendered:
   * the provider setup in the invitation half polls the shell for as long as
   * it is mounted, and mounting it behind a hidden panel would keep a poll
   * running for a form the person cannot see.
   */
  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      id={`boundary-mode-tab-${value}`}
      aria-selected={mode === value}
      aria-controls="boundary-mode-panel"
      // The tab pattern keeps ONE tab in the tab order and moves between them
      // with the arrow keys, so a keyboard user does not tab past the whole
      // strip to reach the second half of the form.
      tabIndex={mode === value ? 0 : -1}
      ref={(element) => {
        tabRefs.current[value] = element;
      }}
      onClick={() => { setMode(value); setError(""); }}
      className={classNames(
        "flex-1 rounded px-3 py-1.5 text-sm",
        mode === value
          ? "bg-accent text-accent-fg"
          : "border border-subtle text-primary hover:bg-inset",
      )}
    >
      {label}
    </button>
  );

  /**
   * The arrow keys move between the tabs, in the direction the tabs are
   * actually drawn. The list is right to left in Arabic, so the arrow that
   * means "onwards" is the one that points that way; a keyboard that moved
   * the wrong way would put the focus on the other side of the screen from
   * where the eye is.
   */
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let next: Mode;
    if (e.key === forward || e.key === "End") next = "machine";
    else if (e.key === back || e.key === "Home") next = "invite";
    else return;
    e.preventDefault();
    setMode(next);
    setError("");
    tabRefs.current[next]?.focus();
  };

  return <>
    <button type="button" className="rounded-md border border-subtle px-3 py-1.5 text-sm text-primary hover:bg-inset" onClick={() => void show()} title={t("support.helpSomeoneTitle")}>{t("support.helpSomeone")}</button>
    {/*
      The shared Dialog primitive, not a native <dialog>.
      A native one is in the TOP LAYER, and top-layer promotion does not reset
      `visibility`, which the pane grid uses to hide a background pane. So a
      native dialog opened while a background pane was hidden stayed in the top
      layer, still modal, and INVISIBLE: the window was blocked by a dialog
      nobody could see and nobody could dismiss. The shared primitive is gated
      on the pane being the visible one, which is what stops that. It also
      brings the focus trap and the Escape handling with it, and the `field`
      and `btn-*` primitives, so this window stops being the only one in the
      app whose inputs look different from everybody else's.
    */}
    {open ? (
      <Dialog title={t("support.helpSomeone")} onClose={close} width={512}>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex flex-col gap-4">
        <div>
          <p className="mt-2 text-sm text-secondary">{t("support.helpOverInternet")}</p>
        </div>
        <div
          className="flex gap-2"
          role="tablist"
          aria-label={t("support.connectMode")}
          onKeyDown={onTabKeyDown}
        >
          {tab("invite", t("support.helpSomeoneNow"))}
          {tab("machine", t("support.reachComputer"))}
        </div>
        <label className="text-sm">{t("support.yourName")}<input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border border-subtle bg-inset p-2" /></label>
        <div
          role="tabpanel"
          id="boundary-mode-panel"
          aria-labelledby={`boundary-mode-tab-${mode}`}
          className="flex flex-col gap-4"
        >
        {mode === "invite" ? <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-secondary">
            <li>{t("support.stepInstallLead")} <strong>{t("gethelp.button")}</strong>{t("support.stepInstallTail")}</li>
            <li>{t("support.stepCodeLead")} <strong>{t("gethelp.getCode")}</strong> {t("support.stepCodeMid")} <strong>{t("gethelp.createInvitation")}</strong> {t("support.stepCodeTail")}</li>
            <li>{t("support.stepUse")}</li>
          </ol>
          <label className="text-sm">{t("support.theirCode")}<textarea required spellCheck={false} autoComplete="off" maxLength={16384} rows={4} value={invitation} onChange={(event) => { setInvitation(event.target.value); setPasted(false); }} placeholder={t("support.theirCodePlaceholder")} className="mt-1 w-full rounded border border-subtle bg-inset p-2 font-mono text-xs" /></label>
          {pasted && <p className="-mt-2 text-xs text-secondary">{t("support.pasted")}</p>}
          {numeric && <label className="text-sm">{t("support.registryUrl")}<input type="url" value={registryUrl} onChange={(event) => setRegistryUrl(event.target.value)} placeholder="https://your-registry.workers.dev" className="mt-1 w-full rounded border border-subtle bg-inset p-2" /><span className="mt-1 block text-xs text-secondary">{t("support.registryHint")}</span></label>}
          {numeric && <label className="text-sm">{t("support.codeServiceUrl")}<input type="url" value={codeService} onChange={(event) => setCodeService(event.target.value)} placeholder="https://codes.example.com" className="mt-1 w-full rounded border border-subtle bg-inset p-2" /><span className="mt-1 block text-xs text-secondary">{t("support.codeServiceHint")}</span></label>}
          <p className="text-xs text-secondary">{t("support.duringSession")}</p>
          <BoundaryProviderSetup active={open} />
        </> : <>
          <p className="text-sm text-secondary">{t("support.machineIntro")}</p>
          <label className="text-sm">{t("support.computerId")}<input required spellCheck={false} autoComplete="off" value={machineId} onChange={(event) => { setMachineId(event.target.value); setPasted(false); }} placeholder={t("support.computerIdPlaceholder")} className="mt-1 w-full rounded border border-subtle bg-inset p-2 font-mono text-xs" dir="ltr" /><span className="mt-1 block text-xs text-secondary">{t("support.computerIdHint")}</span></label>
          <label className="text-sm">{t("support.registryUrl")}<input type="url" value={registryUrl} onChange={(event) => setRegistryUrl(event.target.value)} placeholder="https://your-registry.workers.dev" className="mt-1 w-full rounded border border-subtle bg-inset p-2" dir="ltr" /><span className="mt-1 block text-xs text-secondary">{t("support.registryNumberHint")}</span></label>
          {pasted && <p className="-mt-2 text-xs text-secondary">{t("support.pasted")}</p>}
          {machineId.trim() !== "" && !looksLikeMachineId(machineId) && !looksLikeNumber(machineId) && <p className="-mt-2 text-xs text-danger">{t("support.notAnId")}</p>}
          {looksLikeNumber(machineId) && registryUrl.trim() === "" && <p className="-mt-2 text-xs text-secondary">{t("support.numberNeedsRegistry")}</p>}
          <label className="text-sm">{t("support.libraryName")}<input maxLength={80} value={machineName} onChange={(event) => setMachineName(event.target.value)} placeholder={t("support.libraryNamePlaceholder")} className="mt-1 w-full rounded border border-subtle bg-inset p-2" /></label>
          <label className="text-sm">{t("support.unattendedPassword")}<input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border border-subtle bg-inset p-2" /><span className="mt-1 block text-xs text-secondary">{t("support.unattendedPasswordHint")}</span></label>
        </>}
        </div>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="rounded border border-subtle px-4 py-2">{t("support.cancel")}</button><button disabled={busy || !ready} type="submit" className="rounded bg-accent px-4 py-2 text-accent-fg disabled:opacity-50">{busy ? t("support.opening") : mode === "invite" ? t("support.connect") : t("support.saveAndConnect")}</button></div>
      </form>
      </Dialog>
    ) : null}
  </>;
}
