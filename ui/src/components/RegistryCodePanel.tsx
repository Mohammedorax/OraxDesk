import { useState, type ReactNode } from "react";
import { writeClipboard } from "../lib/tauri";
import { rememberRegistryUrl, rememberedRegistryUrl, registry } from "../lib/support";
import { useT } from "../lib/i18n";

/**
 * The optional Orax registry panel on the person being helped: publish the
 * invitation they already have as a short numeric code through the deployed
 * Worker, or withdraw it before anyone uses it.
 *
 * The registry never carries session data; the invitation it stores is sealed
 * with the Worker's key and lives for minutes.
 */
export function RegistryCodePanel({ invitation }: { invitation: string }): ReactNode {
  const t = useT();
  const [url, setUrl] = useState(rememberedRegistryUrl());
  const [code, setCode] = useState<string | null>(null);
  const [revokeToken, setRevokeToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const create = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    rememberRegistryUrl(url);
    try {
      const result = await registry.createCode(url.trim(), invitation);
      setCode(result.code);
      setRevokeToken(result.revoke_token);
      const until = new Date(result.expires_at * 1000).toLocaleTimeString();
      setMessage(t("registry.ready", { time: until }));
    } catch (err) {
      setError(t("registry.failed", { reason: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!revokeToken) return;
    setBusy(true);
    setError("");
    try {
      await registry.revokeCode(url.trim(), revokeToken);
      setCode(null);
      setRevokeToken(null);
      setMessage(t("registry.withdrawn"));
    } catch (err) {
      setError(t("registry.failed", { reason: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const grouped = code ? code.replace(/(\d{4})(?=\d)/g, "$1 ") : "";

  return (
    <div className="rounded border border-subtle p-3">
      <h4 className="text-sm font-semibold">{t("registry.title")}</h4>
      <p className="mt-1 text-xs text-secondary">
        {t("registry.description")}

      </p>
      <label className="mt-2 block text-sm">
        {t("registry.url")}
        <input
          type="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            rememberRegistryUrl(event.target.value);
          }}
          placeholder="https://orax-registry.example.workers.dev"
          className="mt-1 w-full rounded border border-subtle bg-inset p-2"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || url.trim() === ""}
          onClick={() => void create()}
        >
          {code ? t("registry.createAnother") : t("registry.create")}
        </button>
        {code ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void writeClipboard(code).catch(() => undefined)}
          >
            {t("registry.copy")}
          </button>
        ) : null}
        {code && revokeToken ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void withdraw()}
          >
            {t("registry.withdraw")}
          </button>
        ) : null}
      </div>
      {code ? (
        <p className="mono mt-2 select-all text-center text-2xl font-semibold tracking-wider">{grouped}</p>
      ) : null}
      {message ? <p className="mt-1 text-xs text-secondary">{message}</p> : null}
      {error ? <p role="alert" className="mt-1 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
