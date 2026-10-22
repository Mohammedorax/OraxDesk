import { useEffect, useRef, useState } from "react";
import { mustInvoke } from "../lib/tauri";
import { useT } from "../lib/i18n";

type Progress = { message: string; address: string | null; finished: boolean; failed: boolean };
/**
 * Enrol this device in the person's own Tailscale or Cloudflare network.
 * `onAddress` receives this device's address on that network when setup
 * finishes, for a caller that saves it as the connection to use.
 */
export function BoundaryProviderSetup({ active, intro, onAddress }: { active: boolean; intro?: string; onAddress?: (address: string) => void }) {
  const t = useT();
  const reported = useRef(onAddress);
  reported.current = onAddress;
  const [provider, setProvider] = useState("Tailscale");
  const [token, setToken] = useState("");
  const [team, setTeam] = useState("");
  const [account, setAccount] = useState("");
  const [emails, setEmails] = useState("");
  const [configure, setConfigure] = useState(false);
  const [consent, setConsent] = useState(false);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!active) { setToken(""); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await mustInvoke<Progress | null>("boundary_provider_status");
        if (!alive) return;
        if (state) {
          setMessage(state.message);
          setBusy(!state.finished);
          if (state.finished && state.address) reported.current?.(state.address);
        }
      } catch { if (alive) setMessage(t("provider.statusFailed")); }
      if (alive) timer = setTimeout(() => { void poll(); }, 700);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [active, t]);
  const start = async (removeResources = false) => {
    setBusy(true);
    const authKey = token;
    setToken("");
    try {
      await mustInvoke("boundary_provider_start", { request: {
        remove_resources: removeResources, provider, auth_key: authKey, account_id: account.trim(), team: team.trim(),
        emails: emails.split(",").map(value => value.trim()).filter(Boolean),
        configure_account: provider === "Cloudflare" && configure,
      } });
    } catch (error) { setMessage(String(error)); setBusy(false); }
  };
  const inputClass = "mt-1 w-full rounded border border-subtle bg-inset p-2";
  return <details className="rounded border border-subtle p-3 text-sm">
    <summary className="cursor-pointer">{t("provider.summary")}</summary>
    <div className="mt-3 flex flex-col gap-3">
      <p>{intro ?? t("provider.intro")}</p>
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <label>{t("provider.label")}<select className={inputClass} value={provider} onChange={event => { setProvider(event.target.value); setToken(""); setConsent(false); }}><option>Tailscale</option><option>Cloudflare</option></select></label>
        {provider === "Cloudflare" && <>
          <label>{t("provider.cloudflareTeam")}<input className={inputClass} value={team} onChange={event => setTeam(event.target.value)} /></label>
          <label><input type="checkbox" checked={configure} onChange={event => setConfigure(event.target.checked)} /> {t("provider.configureAccount")}</label>
          {configure && <>
            <label>{t("provider.accountId")}<input className={inputClass} value={account} onChange={event => setAccount(event.target.value)} /></label>
            <label>{t("provider.enrollmentEmails")}<input className={inputClass} value={emails} onChange={event => setEmails(event.target.value)} /></label>
            <p>{t("provider.configureBody")}</p>
          </>}
        </>}
        {(provider === "Tailscale" || configure) && <label>{provider === "Tailscale" ? t("provider.tailscaleAuthKey") : t("provider.cloudflareToken")}<input type="password" autoComplete="off" spellCheck={false} className={inputClass} value={token} onChange={event => setToken(event.target.value)} /></label>}
        <p>{t("provider.installNote")}</p>
        <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> {t("provider.consent")}</label>
        <button type="button" disabled={!consent || busy} onClick={() => void start()} className="rounded border border-subtle px-3 py-2 disabled:opacity-50">{t("provider.installAndConnect")}</button>
      </fieldset>
      {provider === "Cloudflare" && configure && !busy && <>
        <label><input type="checkbox" checked={remove} onChange={event => setRemove(event.target.checked)} /> {t("provider.removePolicy")}</label>
        <button type="button" disabled={!remove} onClick={() => { setRemove(false); void start(true); }}>{t("provider.removeResources")}</button>
      </>}
      {busy && <button type="button" onClick={() => { void mustInvoke("boundary_provider_cancel").catch(error => setMessage(String(error))); }}>{t("provider.cancelSetup")}</button>}
      {message && <p role="status">{message}</p>}
      <p className="text-xs text-secondary">{t("provider.verifyNote")}</p>
    </div>
  </details>;
}
