import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { registry } from "../lib/support";
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
    "idle" | "working" | "ok" | { error: string }
  >("idle");

  const register = useCallback(async (): Promise<void> => {
    if (!inTauri()) return;
    setRegistration("working");
    try {
      const origin = await registry.origin();
      if (origin === "") throw new Error("no registry origin");
      const saved = await registry.registerDevice(origin);
      if (saved.number) {
        setNumber(saved.number);
        window.dispatchEvent(new CustomEvent("oraxdesk:registry-number", { detail: saved.number }));
      }
      setRegistration("ok");
    } catch (err) {
      setRegistration({ error: describeError(err) });
    }
  }, []);

  useEffect(() => {
    void register();
  }, [register]);

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
  return (
    <div className="mt-2 rounded border border-subtle bg-inset/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-secondary">{t("device.number")}</span>
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
            onClick={() => void writeClipboard(number).catch(() => undefined)}
          >
            {t("device.copyNumber")}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-secondary">{t("device.numberHint")}</p>
      {registration === "working" ? (
        <p className="mt-1 text-xs text-secondary">{t("device.registering")}</p>
      ) : null}
      {registration === "ok" ? (
        <p className="mt-1 text-xs text-secondary">{t("device.registered")}</p>
      ) : null}
      {typeof registration === "object" ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-danger">
            {t("device.registerFailed", { reason: registration.error })}
          </p>
          <button
            type="button"
            className="btn-secondary px-2 py-0.5 text-xs"
            onClick={() => void register()}
          >
            {t("device.registerRetry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
