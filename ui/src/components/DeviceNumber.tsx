import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { writeClipboard } from "../lib/tauri";

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
  const bytes = new TextEncoder().encode(machineId.trim().toLowerCase());
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

  useEffect(() => {
    let alive = true;
    void deviceNumber(machineId).then((value) => {
      if (alive) setNumber(value);
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
          <span className="mono select-all text-lg font-semibold tracking-wider">
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
    </div>
  );
}
