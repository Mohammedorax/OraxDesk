import { useEffect, useState, type ReactNode } from "react";
import { writeClipboard } from "../lib/tauri";
import { rememberRegistryUrl, rememberedRegistryUrl, registry } from "../lib/support";
import { useI18n } from "../lib/i18n";

/**
 * The optional Orax registry panel on the person being helped: publish the
 * invitation they already have as a short numeric code through the deployed
 * Worker, or withdraw it before anyone uses it.
 *
 * The registry never carries session data; the invitation it stores is sealed
 * with the Worker's key and lives for minutes.
 */
export function RegistryCodePanel({ invitation }: { invitation: string }): ReactNode {
  const { t, lang } = useI18n();
  const [url, setUrl] = useState(rememberedRegistryUrl());
  const [code, setCode] = useState<string | null>(null);
  const [revokeToken, setRevokeToken] = useState<string | null>(null);
  const [codeOrigin, setCodeOrigin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** What the registry said about itself, once it has been asked. */
  const [health, setHealth] = useState<{ status: string; db: string; invitation_key: string } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    void registry
      .origin()
      .then((value) => {
        if (alive && value !== "") setUrl(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // The registry's own answer about itself, so a person is told "its database
  // is unreachable" rather than "the code could not be created".
  //
  // Debounced: the URL is typed, and asking the registry on every keystroke
  // would be a request per letter for a field nobody is going to finish
  // typing in one go.
  useEffect(() => {
    const target = url.trim();
    if (target === "") {
      setHealth(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void rememberRegistryUrl(target)
        .then(() => (alive ? registry.health(target) : null))
        .then((value) => {
          if (alive && value) setHealth(value);
        })
        .catch(() => {
          if (alive) setHealth(null);
        });
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [url]);

  const create = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    const target = url.trim();
    try {
      await rememberRegistryUrl(target);
      // Registering first is what puts this computer's number in the
      // registry. Without it, the number this person is about to read out
      // cannot be looked up by whoever is helping them, and the lookup
      // answers "no such device" for a computer that is right there.
      await registry.registerDevice(target);
      const result = await registry.createCode(target, invitation);
      setCode(result.code);
      setRevokeToken(result.revoke_token);
      setCodeOrigin(target);
      // The app's language, not the browser's. The panel is read out to the
      // person being helped, and a time written in the browser's locale on
      // a machine whose system is in another language is a time nobody can
      // read out loud.
      const until = new Date(result.expires_at * 1000).toLocaleTimeString(lang);
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
      await registry.revokeCode(codeOrigin ?? url.trim(), revokeToken);
      setCode(null);
      setRevokeToken(null);
      setCodeOrigin(null);
      setMessage(t("registry.withdrawn"));
    } catch (err) {
      setError(t("registry.withdrawFailed", { reason: String(err) }));
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
          }}
          placeholder="https://orax-registry.example.workers.dev"
          dir="ltr"
          style={{ unicodeBidi: "isolate" }}
          className="mt-1 w-full rounded border border-subtle bg-inset p-2"
        />
      </label>
      {health ? (
        <p
          className={
            health.status === "ok"
              ? "mt-1 text-xs text-secondary"
              : "mt-1 text-xs text-danger"
          }
        >
          {health.status === "ok"
            ? t("registry.healthy")
            : t("registry.degraded", {
                db: health.db,
                key: health.invitation_key,
              })}
        </p>
      ) : null}
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
        // The code is read out loud to the person who will use it, so the
        // order of the groups is not a detail. In an Arabic paragraph the
        // spaces between them are bidi neutrals and take the paragraph's
        // direction, so "1234 5678 9012" is displayed as "9012 5678 1234".
        // The run is isolated and pinned left to right, so the digits read in
        // the order they are in.
        <p
          dir="ltr"
          style={{ unicodeBidi: "isolate" }}
          className="mono mt-2 select-all text-center text-2xl font-semibold tracking-wider"
        >
          {grouped}
        </p>
      ) : null}
      {message ? <p className="mt-1 text-xs text-secondary">{message}</p> : null}
      {error ? <p role="alert" className="mt-1 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
