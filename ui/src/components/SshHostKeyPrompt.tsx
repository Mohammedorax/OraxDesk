/**
 * Trust-on-first-use prompt for an SSH host key, and the red hard-stop
 * variant for a CHANGED key. Mirrors `CertPrompt`, but for the SSH layer:
 * this appears BEFORE any session exists, and the pin it writes is shared
 * with the Files panel and the terminal sidecar.
 *
 * Two machines can be behind it, and the words change accordingly. A tunnel
 * GATEWAY stands in front of the machine you asked for, and trusting it says
 * nothing about that machine. A direct SSH session's key IS the machine's.
 * Saying "gateway" in the second case would be describing something that is
 * not there, in a dialog whose entire job is to tell the user what they are
 * about to trust.
 *
 * SSH fingerprints are OpenSSH's `SHA256:...` base64 form, shown verbatim so
 * the user can compare against `ssh-keygen -lf` output on the server.
 */
import type { ReactNode } from "react";
import { useT } from "../lib/i18n";
import { Dialog } from "./primitives";
import type { SshHostKeyPromptState } from "../hooks/useSession";
import { IconAlert, IconLock } from "./icons";

export function SshHostKeyPrompt({
  data,
  onAccept,
  onCancel,
}: {
  data: SshHostKeyPromptState;
  onAccept: () => void;
  onCancel: () => void;
}): ReactNode {
  const t = useT();
  const endpoint = `${data.host}:${data.port}`;
  const gateway = data.gateway;

  if (data.changed) {
    return (
      <Dialog
        title={gateway ? t("sshHostKey.changedTitleGateway") : t("sshHostKey.changedTitle")}
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
            <p className="text-sm break-words text-primary">
              {t("sshHostKey.changedBody", { endpoint })}
            </p>
          </div>
          <KeyBlock label={t("sshHostKey.previouslyTrusted")} value={data.expected ?? ""} />
          <KeyBlock label={t("sshHostKey.presentedNow")} value={data.fingerprint} />
          <div className="flex justify-end">
            <button type="button" data-cancel className="btn-primary" onClick={onCancel}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={gateway ? t("sshHostKey.verifyGatewayTitle", { host: data.host }) : t("sshHostKey.verifyTitle", { host: data.host })}
      onClose={onCancel}
      width={560}
      initialFocusSelector="[data-cancel]"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-warning">
            <IconLock size={20} />
          </span>
          <p className="text-sm break-words text-secondary">
            {gateway
              ? t("sshHostKey.gatewayBody", { endpoint })
              : t("sshHostKey.firstBody", { endpoint })}{" "}
            {t("sshHostKey.verifyHint", { command: "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub" })}
          </p>
        </div>
        <KeyBlock label={data.keyType ?? t("sshHostKey.hostKey")} value={data.fingerprint} />
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" data-cancel className="btn-secondary" onClick={onCancel}>
            {t("support.cancel")}
          </button>
          <button type="button" className="btn-primary" onClick={onAccept}>
            {t("sshHostKey.trust")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function KeyBlock({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="space-y-1 rounded-md bg-inset p-3.5">
      <div className="text-xs text-secondary">{label}</div>
      <div
        className="mono break-all text-xs leading-relaxed text-primary"
        aria-label={`${label} SSH fingerprint`}
      >
        {value}
      </div>
    </div>
  );
}
