import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { writeClipboard } from "../lib/tauri";
import { helpLink } from "../lib/help";
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
  const [copied, setCopied] = useState(false);
  /** Auto-create only once; a failure leaves the button in the person's hand. */
  const autoTried = useRef(false);
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

  const create = useCallback(async (): Promise<void> => {
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
  }, [invitation, lang, t, url]);

  // One click on "Get a code" should end with a code on screen, not with a
  // second button that says "create a code". The registry URL is resolved
  // first, so this waits for the origin rather than firing at an empty URL.
  useEffect(() => {
    if (autoTried.current || code !== null || busy) return;
    if (url.trim() === "") return;
    autoTried.current = true;
    void create();
  }, [busy, code, create, url]);

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

  const copyText = (text: string): void => {
    void writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const grouped = code ? code.replace(/(\d{4})(?=\d)/g, "$1 ") : "";
  const shareMessage = code ? t("registry.shareMessage", { code: grouped }) : "";

  return (
    <div className="rounded border border-subtle bg-surface/50 p-3">
      <h4 className="text-sm font-semibold">{t("registry.title")}</h4>
      <p className="mt-1 text-xs text-secondary">{t("registry.description")}</p>

      {busy && code === null ? (
        <p className="mt-2 text-sm text-secondary">{t("registry.autoCreating")}</p>
      ) : null}

      {code ? (
        <>
          {/* The code is read out loud, so its groups are pinned left to
              right: in an Arabic paragraph the neutral spaces would reverse
              the groups on screen while the copied value stayed correct. */}
          <p
            dir="ltr"
            style={{ unicodeBidi: "isolate" }}
            className="mono mt-3 select-all text-center text-3xl font-semibold tracking-wider"
          >
            {grouped}
          </p>
          <p className="mt-1 text-xs text-secondary">{t("registry.readOut")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => copyText(grouped)}>
              {copied ? t("gethelp.copied") : t("registry.copy")}
            </button>
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => copyText(shareMessage)}>
              {t("registry.copyMessage")}
            </button>
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => copyText(helpLink(code))}>
              {t("registry.link")}
            </button>
            {revokeToken ? (
              <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => void withdraw()}>
                {t("registry.withdraw")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary px-3 py-1 text-xs"
              disabled={busy}
              onClick={() => void create()}
            >
              {t("registry.createAnother")}
            </button>
          </div>
          {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
        </>
      ) : error ? (
        <div className="mt-2">
          <p role="alert" className="text-sm text-danger">{error}</p>
          <button
            type="button"
            className="btn-secondary mt-2 px-3 py-1 text-xs"
            disabled={busy || url.trim() === ""}
            onClick={() => void create()}
          >
            {t("device.registerRetry")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-primary mt-2 px-3 py-1 text-xs"
          disabled={busy || url.trim() === ""}
          onClick={() => void create()}
        >
          {t("registry.create")}
        </button>
      )}

      {message ? <p className="mt-1 text-xs text-secondary">{message}</p> : null}

      {/* The registry origin and its health are deployment details. A beginner
          only needs the code; an administrator can still reach them here. */}
      <details className="mt-2 text-xs text-secondary">
        <summary className="cursor-pointer">{t("registry.advanced")}</summary>
        <label className="mt-2 block text-sm">
          {t("registry.url")}
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://orax-registry.example.workers.dev"
            dir="ltr"
            style={{ unicodeBidi: "isolate" }}
            className="mt-1 w-full rounded border border-subtle bg-inset p-2"
          />
        </label>
        {health ? (
          <p className={health.status === "ok" ? "mt-1" : "mt-1 text-danger"}>
            {health.status === "ok"
              ? t("registry.healthy")
              : t("registry.degraded", {
                  db: health.db,
                  key: health.invitation_key,
                })}
          </p>
        ) : null}
      </details>
    </div>
  );
}
