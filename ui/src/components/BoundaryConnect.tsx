import { useState } from "react";
import { BoundaryProviderSetup } from "./BoundaryProviderSetup";
import { Dialog } from "./primitives";
import { mustInvoke, openSessionWindow, readClipboard } from "../lib/tauri";
import { rememberRegistryUrl, rememberedRegistryUrl, registry } from "../lib/support";
import { describeError } from "../lib/util";
import { useT } from "../lib/i18n";
import { useHosts } from "../state/HostsContext";

const NAME_KEY = "deskvnc.boundary.helperName";

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

/** A machine ID: 64 hex characters, as DeskVNC Support shows it. */
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
 * Help someone now: the person presses Get help in DeskVNC, or opens
 * DeskVNC Support, presses Get a code or Create
 * invitation and sends it; it is pasted here for you when it is already on the
 * clipboard. Connect to a computer: a machine with unattended access, by its
 * ID, saved to the Library so it opens like any other computer afterwards.
 * Rust validates and owns the invitation; it never enters a URL.
 */
export function BoundaryConnect() {
  const t = useT();
  const { saveHost, savePassword } = useHosts();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"invite" | "machine">("invite");
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
      if (url !== "") {
        rememberRegistryUrl(url);
        resolved = await registry.resolveCode(url, typed);
      }
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
    if (/^[0-9 ]+$/.test(target) && target.replaceAll(" ", "").length === 9) {
      const url = registryUrl.trim();
      if (url === "") throw new Error("Enter the registry URL to look up a number");
      rememberRegistryUrl(url);
      let record: { id: string };
      try {
        record = await registry.lookupNumber(url, target);
      } catch (err) {
        // The usual reason is that the other computer has not registered with
        // this registry, which is a different thing from a wrong number and
        // one the person reading the screen can fix.
        throw new Error(
          `No computer with that number is registered at this registry (${describeError(err)}). ` +
            "The other computer has to create a code here first, or give you its full ID.",
        );
      }
      target = record.id;
    }
    const saved = await saveHost({
      friendlyName: machineName.trim() || "Boundary computer",
      address: target,
      port: 0,
      protocol: "boundary",
    });
    if (!saved) throw new Error("The computer could not be saved to the Library");
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
        (/^[0-9 ]+$/.test(machineId.trim()) && machineId.replaceAll(" ", "").length === 9 && registryUrl.trim() !== ""));
  const tab = (value: "invite" | "machine", label: string) => (
    <button
      type="button"
      onClick={() => { setMode(value); setError(""); }}
      className={`flex-1 rounded px-3 py-1.5 text-sm ${mode === value ? "bg-accent text-accent-fg" : "border border-subtle text-primary hover:bg-inset"}`}
    >
      {label}
    </button>
  );

  return <>
    <button type="button" className="rounded-md border border-subtle px-3 py-1.5 text-sm text-primary hover:bg-inset" onClick={() => void show()} title="Connect to someone who asked you for help">{t("support.helpSomeone")}</button>
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
          <p className="mt-2 text-sm text-secondary">Help someone over the internet, with nothing to set up on either network.</p>
        </div>
        <div className="flex gap-2">{tab("invite", t("support.helpSomeoneNow"))}{tab("machine", t("support.reachComputer"))}</div>
        <label className="text-sm">{t("support.yourName")}<input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border border-subtle bg-inset p-2" /></label>
        {mode === "invite" ? <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-secondary">
            <li>In DeskVNC they press <strong>Get help</strong>. Without DeskVNC, they download <strong>DeskVNC Support</strong> from the DeskVNC releases page and open it. Nothing is installed.</li>
            <li>They press <strong>Get a code</strong> or <strong>Create invitation</strong> and send you what it shows.</li>
            <li>You copy it and open this window. It is pasted for you. They approve you on their screen.</li>
          </ol>
          <label className="text-sm">{t("support.theirCode")}<textarea required spellCheck={false} autoComplete="off" maxLength={16384} rows={4} value={invitation} onChange={(event) => { setInvitation(event.target.value); setPasted(false); }} placeholder={t("support.theirCodePlaceholder")} className="mt-1 w-full rounded border border-subtle bg-inset p-2 font-mono text-xs" /></label>
          {pasted && <p className="-mt-2 text-xs text-secondary">{t("support.pasted")}</p>}
          {numeric && <label className="text-sm">{t("support.registryUrl")}<input type="url" value={registryUrl} onChange={(event) => { setRegistryUrl(event.target.value); rememberRegistryUrl(event.target.value); }} placeholder="https://your-registry.workers.dev" className="mt-1 w-full rounded border border-subtle bg-inset p-2" /><span className="mt-1 block text-xs text-secondary">{t("support.registryHint")}</span></label>}
          {numeric && <label className="text-sm">{t("support.codeServiceUrl")}<input type="url" value={codeService} onChange={(event) => setCodeService(event.target.value)} placeholder="https://codes.example.com" className="mt-1 w-full rounded border border-subtle bg-inset p-2" /><span className="mt-1 block text-xs text-secondary">{t("support.codeServiceHint")}</span></label>}
          <p className="text-xs text-secondary">During the session they can choose to let you connect any time. The computer is then saved to your Library and opens unattended.</p>
          <BoundaryProviderSetup active={open} />
        </> : <>
          <p className="text-sm text-secondary">For a computer with unattended access switched on in DeskVNC or DeskVNC Support. A computer that paired you is already in your Library. Otherwise the person there approves you on their screen, and can pair you so you connect without asking next time.</p>
          <label className="text-sm">{t("support.computerId")}<input required spellCheck={false} autoComplete="off" value={machineId} onChange={(event) => { setMachineId(event.target.value); setPasted(false); }} placeholder="Their nine-digit number, or the 64-character ID" className="mt-1 w-full rounded border border-subtle bg-inset p-2 font-mono text-xs" dir="ltr" /><span className="mt-1 block text-xs text-secondary">{t("support.computerIdHint")}</span></label>
          <label className="text-sm">Orax registry URL, to look up a number<input type="url" value={registryUrl} onChange={(event) => { setRegistryUrl(event.target.value); rememberRegistryUrl(event.target.value); }} placeholder="https://your-registry.workers.dev" className="mt-1 w-full rounded border border-subtle bg-inset p-2" dir="ltr" /><span className="mt-1 block text-xs text-secondary">A nine-digit number is looked up through this registry, so both of you need the same one. Leave it empty to use a full ID instead.</span></label>
          {pasted && <p className="-mt-2 text-xs text-secondary">{t("support.pasted")}</p>}
          {machineId.trim() !== "" && !looksLikeMachineId(machineId) && !looksLikeNumber(machineId) && <p className="-mt-2 text-xs text-danger">{t("support.notAnId")}</p>}
          {looksLikeNumber(machineId) && registryUrl.trim() === "" && <p className="-mt-2 text-xs text-secondary">{t("support.numberNeedsRegistry")}</p>}
          <label className="text-sm">{t("support.libraryName")}<input maxLength={80} value={machineName} onChange={(event) => setMachineName(event.target.value)} placeholder="Mum's laptop" className="mt-1 w-full rounded border border-subtle bg-inset p-2" /></label>
          <label className="text-sm">{t("support.unattendedPassword")}<input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border border-subtle bg-inset p-2" /><span className="mt-1 block text-xs text-secondary">{t("support.unattendedPasswordHint")}</span></label>
        </>}
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="rounded border border-subtle px-4 py-2">{t("support.cancel")}</button><button disabled={busy || !ready} type="submit" className="rounded bg-accent px-4 py-2 text-accent-fg disabled:opacity-50">{busy ? t("support.opening") : mode === "invite" ? t("support.connect") : t("support.saveAndConnect")}</button></div>
      </form>
      </Dialog>
    ) : null}
  </>;
}
