import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";
import { mustInvoke, writeClipboard } from "../lib/tauri";
import { groupDigits } from "./DeviceNumber";

interface Identity {
  id: string;
  number: string;
}

/**
 * The always-visible identity of this computer on the library screen: its
 * stable nine-digit number, ready to be read out or copied. No network is
 * involved; the number is derived from this machine's key.
 */
export function DeviceIdentityCard(): ReactNode {
  const { t } = useI18n();
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    let alive = true;
    void mustInvoke<Identity>("machine_identity")
      .then((value) => {
        if (alive) setIdentity(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (identity === null) return null;
  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-subtle bg-inset/40 px-3 py-2">
      <span className="text-sm text-secondary">{t("device.number")}</span>
      <div className="flex items-center gap-2">
        <span className="mono select-all text-lg font-semibold tracking-wider">
          {groupDigits(identity.number)}
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void writeClipboard(identity.number).catch(() => undefined)}
        >
          {t("device.copyNumber")}
        </button>
      </div>
    </div>
  );
}
