import { useEffect, useState, type ReactNode } from "react";
import { BoundaryProviderSetup } from "./BoundaryProviderSetup";
import { DeviceNumber } from "./DeviceNumber";
import { RegistryCodePanel } from "./RegistryCodePanel";
import { writeClipboard } from "../lib/tauri";
import { Dialog } from "./primitives";
import { useI18n, useT } from "../lib/i18n";
import {
  setCodeService,
  shortId,
  support,
  useSupport,
  type NetworkProfile,
  type SupportView,
} from "../lib/support";

/**
 * Get help: let someone see or control this computer, with nothing else to
 * download. Everything OraxDesk Support offers the person being helped is
 * here: a code or invitation, the approval, control and their tools as
 * separate choices, pairing, and unattended access.
 *
 * The approval itself and the banner shown while someone is connected live in
 * `SupportOverlay`, so they appear whether or not this window is open.
 */
export function GetHelp(): ReactNode {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const view = useSupport();
  const show = () => {
    setOpen(true);
    void support.refreshDisplays().catch(() => undefined);
  };
  const close = () => {
    setOpen(false);
  };
  const helping = (view?.unattended.active.length ?? 0) > 0;
  const busy = view?.sharing || helping;
  return (
    <>
      <button
        type="button"
        className={`rounded-md border px-3 py-1.5 text-sm hover:bg-inset ${busy ? "border-danger text-danger" : "border-subtle text-primary"}`}
        onClick={show}
        title={t("gethelp.intro")}
      >
        {view?.connected || helping ? t("gethelp.sharing") : t("gethelp.button")}
      </button>
      {/*
        The shared Dialog primitive, not a native <dialog>. A native one is in
        the TOP LAYER, and top-layer promotion does not reset `visibility`,
        which the pane grid uses to hide a background pane. So a native dialog
        opened while a background pane was hidden stayed in the top layer,
        still modal, and INVISIBLE: the window was blocked by a dialog nobody
        could see and nobody could dismiss. The shared primitive is gated on
        the pane being the visible one, which is what stops that.
      */}
      {open ? (
        <Dialog title={t("gethelp.title")} onClose={close} width={720}>
          {view ? (
            <Body view={view} />
          ) : (
            // The window used to open EMPTY: the support state arrives from
            // the shell a moment later, and until it did there was nothing
            // in the dialog at all, just a dimmed screen.
            <div className="py-6 text-center text-sm text-secondary">
              <p>{t("gethelp.loading")}</p>
            </div>
          )}
        </Dialog>
      ) : null}
    </>
  );
}

function Body({ view }: { view: SupportView }): ReactNode {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const run = (action: () => Promise<unknown>) => {
    setError("");
    action().catch((err) => setError(String(err)));
  };
  return (
    <div className="flex flex-col gap-4">
      {/*
        The title and the close button are the Dialog primitive's own now, so
        this window has one header rather than two.
      */}
      <p className="-mt-1 text-sm text-secondary">{t("gethelp.intro")}</p>
      <section className="rounded-lg border border-subtle bg-surface p-4">
        {view.connected ? <Sharing view={view} run={run} /> : <Share view={view} run={run} />}
      </section>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <StatusLine view={view} />
      <details className="rounded-lg border border-subtle p-4">
        <summary className="cursor-pointer font-medium">{t("gethelp.settings")}</summary>
        <div className="mt-4 flex flex-col gap-6">
          <ScreenSettings view={view} run={run} />
          <UnattendedSettings view={view} run={run} />
          <ConnectionSettings view={view} />
          <CodeSettings view={view} />
        </div>
      </details>
    </div>
  );
}

type Run = (action: () => Promise<unknown>) => void;

function Copy({ text, label }: { text: string; label: string }): ReactNode {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary px-3 py-1 text-xs"
      onClick={() => {
        void writeClipboard(text).then((ok) => {
          setDone(ok);
          if (ok) setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? t("gethelp.copied") : label}
    </button>
  );
}

function ScreenPermission(): ReactNode {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>{t("gethelp.screenPermission")}</p>
      <div>
        <button type="button" className="btn-secondary" onClick={() => void support.requestScreenPermission()}>
          {t("gethelp.allowScreenRecording")}
        </button>
      </div>
      <p className="text-xs text-secondary">{t("gethelp.screenPermissionHint")}</p>
    </div>
  );
}

function DisplayPicker({ view, run }: { view: SupportView; run: Run }): ReactNode {
  return (
    <select
      className="field"
      value={view.display ?? ""}
      disabled={view.sharing}
      onChange={(event) => run(() => support.setDisplay(Number(event.target.value)))}
    >
      {view.displays.map((display) => (
        <option key={display.id} value={display.id}>
          {display.name}
        </option>
      ))}
    </select>
  );
}

/** Before anyone is connected: the code, or the button that makes one. */
function Share({ view, run }: { view: SupportView; run: Run }): ReactNode {
  const { t } = useI18n();
  const label = view.codesAvailable ? t("gethelp.getCode") : t("gethelp.createInvitation");
  let body: ReactNode;
  if (!view.sharing) {
    if (!view.screenPermission) body = <ScreenPermission />;
    else if (view.displays.length === 0) body = <p className="text-sm text-danger">{t("gethelp.noDisplayToShare")}</p>;
    else
      body = (
        <>
          {view.displays.length > 1 ? (
            <label className="text-sm">
              {t("gethelp.shareScreen")}
              <div className="mt-1">
                <DisplayPicker view={view} run={run} />
              </div>
            </label>
          ) : null}
          <button
            type="button"
            className="btn-primary w-full py-3 text-base"
            disabled={view.networkError !== null}
            onClick={() => run(support.share)}
          >
            {label}
          </button>
          <p className="text-xs text-secondary">{t("gethelp.shareIntro")}</p>
        </>
      );
  } else if (!view.invitation || view.codeBusy) {
    body = (
      <>
        <p className="text-sm text-secondary">{view.invitation ? t("gethelp.gettingCode") : t("gethelp.creatingCode")}</p>
        {view.invitation ? (
          <div>
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => run(support.fullInvitation)}>
              {t("gethelp.useFullInvitation")}
            </button>
          </div>
        ) : null}
      </>
    );
  } else if (view.code) {
    body = (
      <>
        <p className="mono select-all text-center text-3xl font-semibold tracking-wider">{view.code}</p>
        <p className="text-xs text-secondary">{t("gethelp.readOut")}</p>
        <div className="flex gap-2">
          <Copy text={view.code} label={t("gethelp.copyCode")} />
          <Copy text={view.invitation} label={t("gethelp.copyInvitation")} />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <textarea
          readOnly
          rows={4}
          value={view.invitation}
          className="mono w-full rounded border border-subtle bg-inset p-2 text-xs"
          onFocus={(event) => event.target.select()}
        />
        <div>
          <Copy text={view.invitation} label={t("gethelp.copyInvitationText")} />
        </div>
        <p className="text-xs text-secondary">{t("gethelp.sendPrivately")}</p>
        {view.codeMessage ? <p className="text-sm text-danger">{view.codeMessage}</p> : null}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">{t("gethelp.allowRemoteControl")}</h3>
        <p className="text-sm text-secondary">
          {t("gethelp.giveAccess", {
            what: view.codesAvailable ? t("gethelp.thisCode") : t("gethelp.thisInvitation"),
          })}
        </p>
      </div>
      {view.unattended.machineId ? <DeviceNumber machineId={view.unattended.machineId} /> : null}
      {body}
      {view.sharing && view.invitation ? <RegistryCodePanel invitation={view.invitation} /> : null}
      {view.sharing ? (
        <div>
          <button type="button" className="btn-secondary" onClick={() => run(support.stop)}>
            {t("support.cancel")}
          </button>
        </div>
      ) : null}
      <UnattendedSummary view={view} />
    </div>
  );
}

function UnattendedSummary({ view }: { view: SupportView }): ReactNode {
  const { t } = useI18n();
  const u = view.unattended;
  return (
    <div className="mt-2 border-t border-subtle pt-3 text-sm">
      <p>
        {t("gethelp.unattended")}:{" "}
        {u.enabled ? (
          <span className="text-success">{u.reachable ? t("gethelp.on") : t("gethelp.starting")}</span>
        ) : (
          <span className="text-secondary">{t("gethelp.offInSettings")}</span>
        )}
      </p>
      {u.enabled ? (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-secondary">{t("device.id")}</span>
            <span className="mono text-xs">{shortId(u.machineId)}</span>
            <Copy text={u.machineId} label={t("device.copyId")} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** While a helper is connected. */
function Sharing({ view, run }: { view: SupportView; run: Run }): ReactNode {
  const t = useT();
  const helper = view.helper;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">{t("gethelp.screenShared")}</h3>
        <p className="text-sm text-secondary">{t("gethelp.helperSees")}</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={view.control}
          disabled={!view.inputPermission}
          onChange={(event) => run(() => support.setControl(event.target.checked))}
        />
        {t("gethelp.allowControl")}
      </label>
      {!view.inputPermission ? (
        <div className="text-sm">
          <p className="text-secondary">{t("gethelp.controlNeedsAccessibility")}</p>
          <button type="button" className="btn-secondary mt-1" onClick={() => void support.openInputSettings()}>
            {t("gethelp.openAccessibility")}
          </button>
        </div>
      ) : null}
      {view.toolsOffered ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={view.tools}
              onChange={(event) => run(() => support.setTools(event.target.checked))}
            />
            {t("gethelp.allowTools")}
          </label>
          {view.activity.length > 0 ? (
            <div>
              <p className="text-xs text-secondary">{t("gethelp.toolsDid")}</p>
              {view.activity.map((line, index) => (
                <p key={index} className="mono truncate text-xs">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {helper ? (
        helper.paired ? (
          <p className="text-sm text-secondary">{t("gethelp.pairedHelperNote", { name: helper.name })}</p>
        ) : (
          <div>
            <button
              type="button"
              className="btn-secondary"
              title={t("gethelp.pairTitle")}
              onClick={() => run(support.pair)}
            >
              {t("gethelp.pairButton", { name: helper.name })}
            </button>
          </div>
        )
      ) : null}
      <div>
        <button type="button" className="btn-danger" onClick={() => run(support.stop)}>
          {t("gethelp.endSession")}
        </button>
      </div>
    </div>
  );
}

function StatusLine({ view }: { view: SupportView }): ReactNode {
  const color = view.error ? "bg-danger" : view.connected || !view.sharing ? "bg-success" : "bg-warning";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`inline-block size-2 rounded-full ${color}`} />
      <span>{view.status}</span>
      {view.warning ? <span className="text-warning">{view.warning}</span> : null}
      {view.route ? <span className="text-secondary">{view.route}</span> : null}
      <span className="ml-auto text-secondary">{view.networkLabel}</span>
    </div>
  );
}

function ScreenSettings({ view, run }: { view: SupportView; run: Run }): ReactNode {
  const t = useT();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">{t("gethelp.screenToShare")}</h3>
      {view.displays.length > 0 ? (
        <div className="flex gap-2">
          <DisplayPicker view={view} run={run} />
          <button type="button" className="btn-secondary shrink-0" onClick={() => run(support.refreshDisplays)}>
            {t("gethelp.refresh")}
          </button>
        </div>
      ) : (
        <p className="text-sm text-danger">{t("gethelp.noDisplay")}</p>
      )}
      {!view.screenPermission ? <ScreenPermission /> : null}
      {!view.inputPermission ? (
        <div className="text-sm">
          <p className="text-secondary">{t("gethelp.accessibilityNeeded")}</p>
          <button type="button" className="btn-secondary mt-1" onClick={() => void support.openInputSettings()}>
            {t("gethelp.openAccessibility")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function UnattendedSettings({ view, run }: { view: SupportView; run: Run }): ReactNode {
  const { t } = useI18n();
  const u = view.unattended;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [local, setLocal] = useState("");
  const setNewPassword = () => {
    setLocal("");
    if (password !== confirm) {
      setLocal(t("gethelp.passwordsDiffer"));
      return;
    }
    // The boxes are cleared only once the write has SUCCEEDED. They used to
    // be emptied the moment the write was asked for, so a keychain that
    // refused threw away a password the person could not see and could not
    // write down again.
    run(() =>
      support.setPassword(password).then(() => {
        setPassword("");
        setConfirm("");
      }),
    );
  };
  return (
    <section className="flex flex-col gap-2 text-sm">
      <h3 className="font-semibold">{t("gethelp.unattended")}</h3>
      <p className="text-secondary">{t("gethelp.unattendedIntro")}</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={u.enabled} onChange={(event) => run(() => support.setUnattended(event.target.checked))} />
        {t("gethelp.allowUnattended")}
      </label>
      {u.enabled ? (
        <div>
          <p className="text-xs text-secondary">{u.reachable ? t("gethelp.idReachable") : t("device.id")}</p>
          <div className="flex items-center gap-2">
            <span className="mono break-all text-xs" dir="ltr">{u.machineId}</span>
            <Copy text={u.machineId} label={t("device.copyId")} />
          </div>
          <p className="mt-1 text-xs text-secondary">{t("gethelp.helperEntersId")}</p>
        </div>
      ) : null}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={u.autostart} onChange={(event) => run(() => support.setAutostart(event.target.checked))} />
        {t("gethelp.autostart")}
      </label>
      <p className="mt-2 text-xs text-secondary">{t("gethelp.paired")}</p>
      {u.helpers.length === 0 ? (
        <p className="text-xs text-secondary">{t("gethelp.noPairedYet")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {u.helpers.map((helper) => (
            <li key={helper.id} className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{helper.name}</span>
              <span className="mono text-xs text-secondary">{shortId(helper.id)}</span>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={helper.control}
                  onChange={(event) => run(() => support.setHelper(helper.id, event.target.checked, helper.tools))}
                />
                {t("gethelp.mayControl")}
              </label>
              <label
                className="flex items-center gap-1 text-xs"
                title={t("gethelp.toolsNote")}
              >
                <input
                  type="checkbox"
                  checked={helper.tools}
                  onChange={(event) => run(() => support.setHelper(helper.id, helper.control, event.target.checked))}
                />
                {t("gethelp.mayRunTools")}
              </label>
              <button type="button" className="btn-secondary ml-auto px-2.5 py-1 text-xs" onClick={() => run(() => support.removeHelper(helper.id))}>
                {t("gethelp.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-secondary">{t("gethelp.unattendedPassword")}</p>
      <p className="text-xs text-secondary">{t("gethelp.unattendedPasswordHint", { min: u.minPassword })}</p>
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t("gethelp.newPassword")}
          className="field max-w-48"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t("gethelp.repeatPassword")}
          className="field max-w-48"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          // Both boxes, not just the first: a password that was typed once
          // and never repeated is not a password anybody can set, and the
          // button said it was ready.
          disabled={password === "" || confirm === ""}
          onClick={setNewPassword}
        >
          {t("gethelp.setPassword")}
        </button>
        {u.hasPassword ? (
          <button type="button" className="btn-secondary" onClick={() => run(() => support.setPassword(null))}>
            {t("gethelp.removePassword")}
          </button>
        ) : null}
      </div>
      {local ? <p className="text-danger">{local}</p> : null}
      {u.message ? <p className={u.error ? "text-danger" : "text-success"}>{u.message}</p> : null}
    </section>
  );
}

type Choice = "Automatic" | "Provider" | "Private" | "Relay";

function ConnectionSettings({ view }: { view: SupportView }): ReactNode {
  const t = useT();
  const [choice, setChoice] = useState<Choice>(view.network.mode);
  const [address, setAddress] = useState(view.network.mode === "Private" ? view.network.address : "");
  const [relay, setRelay] = useState(view.network.mode === "Relay" ? view.network.url : "");
  const [message, setMessage] = useState("");
  useEffect(() => setMessage(""), [choice]);
  const profile = (): NetworkProfile => {
    if (choice === "Automatic") return { mode: "Automatic" };
    if (choice === "Relay") return { mode: "Relay", url: relay.trim() };
    return { mode: "Private", address: address.trim() };
  };
  const save = () => {
    setMessage("");
    support
      .saveNetwork(profile())
      .then(() => setMessage(t("gethelp.savedTry")))
      .catch((err) => setMessage(String(err)));
  };
  const radio = (value: Choice, label: string) => (
    <label className="flex items-center gap-2">
      <input type="radio" name="support-network" checked={choice === value} onChange={() => setChoice(value)} />
      {label}
    </label>
  );
  const ready = choice === "Automatic" || (choice === "Relay" ? relay.trim() !== "" : address.trim() !== "");
  return (
    <section className="flex flex-col gap-2 text-sm">
      <h3 className="font-semibold">{t("gethelp.connection")}</h3>
      <p className="text-secondary">{t("gethelp.now", { network: view.networkLabel })}</p>
      {view.networkError ? <p className="text-danger">{view.networkError}</p> : null}
      <fieldset disabled={view.sharing} className="flex flex-col gap-2">
        {radio("Automatic", t("gethelp.automatic"))}
        {radio("Provider", t("gethelp.provider"))}
        {radio("Private", t("gethelp.private"))}
        {radio("Relay", t("gethelp.relay"))}
        {choice === "Automatic" ? (
          <p className="text-xs text-secondary">{t("gethelp.automaticHint")}</p>
        ) : null}
        {choice === "Provider" ? (
          <>
            <BoundaryProviderSetup
              active
              intro={t("gethelp.providerIntro")}
              onAddress={setAddress}
            />
            {address ? <p className="text-xs">{t("gethelp.addressOnNetwork", { address })}</p> : null}
          </>
        ) : null}
        {choice === "Private" ? (
          <label>
            {t("gethelp.localIp")}
            <input className="field mt-1" value={address} onChange={(event) => setAddress(event.target.value)} />
            <span className="mt-1 block text-xs text-secondary">{t("gethelp.localIpHint")}</span>
          </label>
        ) : null}
        {choice === "Relay" ? (
          <label>
            {t("gethelp.relayUrl")}
            <input className="field mt-1" value={relay} onChange={(event) => setRelay(event.target.value)} />
            <span className="mt-1 block text-xs text-secondary">{t("gethelp.relayUrlHint")}</span>
          </label>
        ) : null}
        {choice === "Provider" || choice === "Private" ? (
          <p className="text-xs text-secondary">{t("gethelp.privateWarning")}</p>
        ) : null}
        <div>
          <button type="button" className="btn-secondary" disabled={!ready} onClick={save}>
            {t("gethelp.saveConnection")}
          </button>
        </div>
      </fieldset>
      {view.sharing ? <p className="text-xs text-secondary">{t("gethelp.endSessionToChange")}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function CodeSettings({ view }: { view: SupportView }): ReactNode {
  const t = useT();
  const [url, setUrl] = useState(view.codeService);
  const [message, setMessage] = useState("");
  const save = () => {
    setMessage("");
    setCodeService(url)
      .then(() => setMessage(t("gethelp.saved")))
      .catch((err) => setMessage(String(err)));
  };
  return (
    <section className="flex flex-col gap-2 text-sm">
      <h3 className="font-semibold">{t("gethelp.shortCodes")}</h3>
      <p className="text-secondary">{t("gethelp.shortCodesHint")}</p>
      <div className="flex gap-2">
        <input
          type="url"
          className="field"
          placeholder="https://codes.example.com"
          value={url}
          disabled={view.sharing}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="button" className="btn-secondary shrink-0" disabled={view.sharing} onClick={save}>
          {t("gethelp.save")}
        </button>
      </div>
      <p className="text-xs text-secondary">{t("gethelp.codeServiceHint")}</p>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
