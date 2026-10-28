import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { registryErrorKind } from "../lib/help";
import { registry, support } from "../lib/support";
import { inTauri, mustInvoke, writeClipboard } from "../lib/tauri";
import { describeError } from "../lib/util";

/**
 * A short, stable number for this computer, shown to the person asking for help
 * and to the helper they read it to.
 *
 * It is derived from the device's endpoint id with SHA-256, so it never changes
 * for a given machine, needs no server round trip, and can be printed on the
 * screen the person is looking at. It is an identifier, not a secret: connecting
 * still needs the short-lived code and the person's approval.
 */
export async function deviceNumber(machineId: string): Promise<string> {
  // The backend owns the derivation, and its answer is the one the registry
  // stores. The calculation below is the fallback for the browser build,
  // where there is no backend to ask, and it has to agree with the backend's
  // to the digit.
  //
  // The backend hashes the raw 32-byte public key, and the endpoint id is its
  // lower-case hex. Decode it so both sides produce the same nine digits.
  const clean = machineId.trim().toLowerCase();
  const bytes = /^[0-9a-f]{64}$/.test(clean)
    ? Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16))
    : new TextEncoder().encode(clean);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const value =
    ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return String(value % 1_000_000_000).padStart(9, "0");
}

export function groupDigits(value: string): string {
  return value.replace(/(\d{3})(?=\d)/g, "$1 ");
}

export function DeviceNumber({ machineId }: { machineId: string }): ReactNode {
  const { t } = useI18n();
  const [number, setNumber] = useState("");
  const [registration, setRegistration] = useState<
    "idle" | "working" | "ok" | "disabled" | { error: string }
  >("idle");
  const [autoRegister, setAutoRegister] = useState(true);
  /**
   * The registration is a network round trip and the background task also
   * retries, so two clicks (or a focus event) must not start two registrations
   * at once. This is a ref rather than state because the guard has to be true
   * before React has rendered the "working" state.
   */
  const inFlight = useRef(false);
  const retryDelay = useRef(5_000);

  const register = useCallback(async (): Promise<void> => {
    if (!inTauri() || inFlight.current) return;
    inFlight.current = true;
    setRegistration("working");
    try {
      const origin = await registry.origin();
      if (origin === "") throw new Error("no registry origin");
      const saved = await registry.registerDevice(origin);
      if (saved.number) {
        setNumber(saved.number);
        window.dispatchEvent(new CustomEvent("oraxdesk:registry-number", { detail: saved.number }));
      }
      retryDelay.current = 5_000;
      setRegistration("ok");
    } catch (err) {
      setRegistration({ error: describeError(err) });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void registry
      .autoRegister()
      .then((enabled) => {
        if (!alive) return;
        setAutoRegister(enabled);
        if (enabled) void register();
        else setRegistration("disabled");
      })
      .catch(() => {
        if (alive) void register();
      });
    return () => {
      alive = false;
    };
  }, [register]);

  const toggleAutoRegister = async (enabled: boolean): Promise<void> => {
    setAutoRegister(enabled);
    if (!enabled) {
      setRegistration("disabled");
      await registry.setAutoRegister(false).catch(() => undefined);
      return;
    }
    retryDelay.current = 5_000;
    await registry.setAutoRegister(true).catch(() => undefined);
    await register();
  };

  // A failed registration retries itself. The backend already has its own
  // retry loop; this one keeps the card truthful while the person is looking
  // at it, and it backs off instead of hammering a registry that is down.
  useEffect(() => {
    if (!autoRegister || typeof registration !== "object") return;
    const delay = retryDelay.current;
    retryDelay.current = Math.min(Math.round(delay * 2), 5 * 60_000);
    const timer = window.setTimeout(() => void register(), delay);
    return () => window.clearTimeout(timer);
  }, [autoRegister, registration, register]);

  // Coming back from the date/time settings is the moment a clock failure is
  // most likely fixed, and regaining the network is the moment an offline
  // failure is most likely fixed. Both should retry immediately rather than
  // waiting for the backoff timer.
  useEffect(() => {
    if (!autoRegister || typeof registration !== "object") return;
    const retry = (): void => {
      void register();
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [autoRegister, registration, register]);

  useEffect(() => {
    let alive = true;
    // The backend first, because it is the authority. The browser
    // calculation is the fallback, and the two are the same number.
    void mustInvoke<{ number: string }>("machine_identity")
      .then((value) => {
        if (alive && value?.number) setNumber(value.number);
      })
      .catch(() => {
        if (!alive) return;
        void deviceNumber(machineId).then((value) => {
          if (alive) setNumber(value);
        });
      });
    return () => {
      alive = false;
    };
  }, [machineId]);

  if (number === "") return null;

  const error = typeof registration === "object" ? registration.error : "";
  const errorKind = error === "" ? "other" : registryErrorKind(error);
  const ready = registration === "ok";
  const canRead = ready || registration === "disabled";

  return (
    <div className="mt-2 rounded border border-subtle bg-inset/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-secondary">
          <span
            aria-hidden="true"
            className={`inline-block size-2 rounded-full ${
              ready ? "bg-success" : error ? "bg-danger" : registration === "disabled" ? "bg-tertiary" : "bg-warning"
            }`}
          />
          {t("device.number")}
        </span>
        <div className="flex items-center gap-2">
          {/*
            The number is a run of digits with spaces in it, and it is read
            OUT LOUD to another person, so its order is not a detail.

            In an Arabic paragraph the spaces between the groups are bidi
            neutrals, and they take the paragraph's direction, so the three
            groups are laid out right to left: "123 456 789" is displayed as
            "789 456 123". The clipboard copy is unaffected, so the number
            works and the SCREEN does not, and the failure only shows up when
            the lookup fails.

            The run is isolated and pinned left to right, so the digits are
            in the order they are in.
          */}
          <span
            dir="ltr"
            style={{ unicodeBidi: "isolate" }}
            className="mono select-all text-lg font-semibold tracking-wider"
          >
            {groupDigits(number)}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={!canRead}
            title={canRead ? undefined : t("device.registerNotReady")}
            onClick={() => void writeClipboard(number).catch(() => undefined)}
          >
            {t("device.copyNumber")}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-secondary">{t("device.numberHint")}</p>
      <label className="mt-2 flex items-start gap-2 text-xs text-secondary">
        <input
          type="checkbox"
          checked={autoRegister}
          onChange={(event) => void toggleAutoRegister(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-primary">{t("device.autoRegister")}</span>
          {t("device.autoRegisterHint")}
        </span>
      </label>
      {registration === "idle" || registration === "working" ? (
        <p className="mt-1 text-xs text-secondary">{t("device.registering")}</p>
      ) : null}
      {registration === "ok" ? (
        <p className="mt-1 text-xs text-success">{t("device.registered")}</p>
      ) : null}
      {registration === "disabled" ? (
        <p className="mt-1 text-xs text-secondary">{t("device.autoRegisterOff")}</p>
      ) : null}
      {typeof registration === "object" ? (
        <div className="mt-2 rounded border border-danger/40 bg-danger/10 p-2">
          <p role="alert" className="text-xs text-danger">
            {errorKind === "clock"
              ? t("device.registerClock")
              : errorKind === "network"
                ? t("device.registerNetwork")
                : t("device.registerNotReady")}
          </p>
          <details className="mt-1 text-xs text-secondary">
            <summary className="cursor-pointer">{t("device.registerFailed")}</summary>
            <p className="mt-1 break-all font-mono text-2xs">{error}</p>
          </details>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs"
              onClick={() => void register()}
            >
              {t("device.registerRetry")}
            </button>
            {errorKind === "clock" ? (
              <button
                type="button"
                className="btn-secondary px-2 py-0.5 text-xs"
                onClick={() => void support.openTimeSettings().catch(() => undefined)}
              >
                {t("device.fixTime")}
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-2xs text-secondary">{t("device.retrying")}</p>
        </div>
      ) : null}
    </div>
  );
}
