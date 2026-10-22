/**
 * Certificate trust-on-first-use prompt, and the red hard-stop variant for a
 * CHANGED fingerprint. Focus defaults to Cancel in both; the changed variant
 * never defaults to accept and requires typed confirmation to proceed.
 */
import { useState, type ReactNode } from "react";
import { Dialog } from "./primitives";
import { fingerprintMnemonic, formatFingerprint } from "../lib/util";
import { useT } from "../lib/i18n";
import { IconAlert, IconLock } from "./icons";
import type { PinScheme } from "../lib/types";

export interface CertPromptData {
  fingerprint: string;
  subject: string;
  isChange: boolean;
  hostName: string;
  /**
   * Which key this fingerprint belongs to. Routing, not copy: it is handed
   * back to `trust_certificate` untouched. It reaches the copy only through
   * the one branch below, because what a user can usefully verify differs.
   */
  scheme: PinScheme;
}

export function CertPrompt({
  data,
  onTrust,
  onConnectOnce,
  onCancel,
}: {
  data: CertPromptData;
  onTrust: () => void;
  onConnectOnce: () => void;
  onCancel: () => void;
}): ReactNode {
  const t = useT();
  const mnemonic = fingerprintMnemonic(data.fingerprint);
  const [confirmText, setConfirmText] = useState("");
  // The phrase the person has to type, in the language they are reading. It
  // is the same words as the button below it, so there is nothing to guess.
  const phrase = t("cert.trustNewIdentity").trim().toLowerCase();

  if (data.isChange) {
    const confirmed = confirmText.trim().toLowerCase() === phrase;
    return (
      <Dialog
        title={t("cert.changedTitle")}
        onClose={onCancel}
        danger
        width={560}
        initialFocusSelector="[data-cancel]"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-md bg-danger-subtle p-3.5">
            <span className="mt-0.5 shrink-0 text-danger">
              <IconAlert size={20} />
            </span>
            <p className="text-sm text-primary">
              <strong>{data.hostName}</strong>{" "}
              {t("cert.changedBody")} <strong>{t("cert.changedWarning")}</strong>
              {data.scheme === "rdp-tls" ? (
                <span className="mt-2 block">
                  {t("cert.changedRdp")}
                </span>
              ) : null}
            </p>
          </div>
          <FingerprintBlock fingerprint={data.fingerprint} mnemonic={mnemonic} subject={data.subject} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-secondary">
              {t("cert.typeToProceed")} <span className="mono">{t("cert.trustNewIdentity")}</span>
            </span>
            <input
              className="field mono"
              value={confirmText}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2.5">
            <button type="button" data-cancel className="btn-primary" onClick={onCancel}>
              {t("cert.cancelRecommended")}
            </button>
            <button
              type="button"
              className="btn-danger disabled:opacity-40"
              disabled={!confirmed}
              onClick={onTrust}
            >
              {t("cert.trustNewIdentity")}
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={t("cert.verifyTitle", { host: data.hostName })}
      onClose={onCancel}
      width={560}
      initialFocusSelector="[data-cancel]"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-warning">
            <IconLock size={20} />
          </span>
          <p className="text-sm text-secondary">
            {data.scheme === "rdp-tls" ? (
              <>
                {t("cert.firstTimeRdp")}
              </>
            ) : (
              <>
                {t("cert.firstTime")}
              </>
            )}
          </p>
        </div>
        <FingerprintBlock fingerprint={data.fingerprint} mnemonic={mnemonic} subject={data.subject} />
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" data-cancel className="btn-secondary" onClick={onCancel}>
            {t("host.cancel")}
          </button>
          <button type="button" className="btn-secondary" onClick={onConnectOnce}>
            {t("cert.connectOnce")}
          </button>
          <button type="button" className="btn-primary" onClick={onTrust}>
            {t("cert.trustComputer")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function FingerprintBlock({
  fingerprint,
  mnemonic,
  subject,
}: {
  fingerprint: string;
  mnemonic: string;
  subject: string;
}): ReactNode {
  const t = useT();
  return (
    <div className="space-y-2 rounded-md bg-inset p-3.5">
      {subject ? <div className="text-xs text-secondary">{subject}</div> : null}
      <div className="mono break-all text-xs leading-relaxed text-primary" aria-label={t("cert.fingerprintAria")}>
        {formatFingerprint(fingerprint)}
      </div>
      {mnemonic ? (
        <div className="text-sm">
          <span className="text-tertiary">{t("cert.fingerprintWords")} </span>
          <span className="mono font-medium text-accent">{mnemonic}</span>
        </div>
      ) : null}
    </div>
  );
}
