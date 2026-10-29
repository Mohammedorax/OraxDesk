import { useState, type ReactNode } from "react";
import { Dialog } from "./primitives";
import {
  inboxAdd,
  inboxList,
  inboxRefresh,
  inboxRemove,
  openSessionWindow,
} from "../lib/tauri";
import {
  inboxStateLook,
  isMissingRegistryError,
  normalizeInboxNumber,
  type InboxTone,
} from "../lib/inbox";
import type { InboxEntry } from "../lib/types";
import { useI18n, useLang } from "../lib/i18n";
import { useHosts } from "../state/HostsContext";
import { classNames, describeError, timeAgo } from "../lib/util";

/** How each tone is drawn. The words are in the catalogue; the colour is here. */
const TONE_CLASS: Record<InboxTone, string> = {
  muted: "border-subtle text-secondary",
  good: "border-success text-success",
  warn: "border-warning text-warning",
  bad: "border-danger text-danger",
};

/**
 * The support inbox: the numbers clients send, and what the registry says.
 *
 * The list is LOCAL. A number is something a client read out to the operator
 * and a note is the operator's own words, and neither ever leaves this
 * machine: the only thing that goes out is a lookup of the number in the
 * registry.
 *
 * That lookup happens on demand and nowhere else. The Worker's free plan has
 * a daily request budget and the lookup is rate limited per address, so a
 * list that refreshed itself in the background would spend the budget on a
 * screen nobody is looking at. Hence the single Check the registry button,
 * and hence the connect button asks the registry first when the number has
 * never been looked up.
 */
export function InboxDialog(): ReactNode {
  const { t } = useI18n();
  const lang = useLang();
  const { hosts, saveHost } = useHosts();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [number, setNumber] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  const show = (): void => {
    setOpen(true);
    setError("");
    setNotice("");
    void inboxList()
      .then(setEntries)
      .catch((err: unknown) => setError(describeError(err)));
  };

  const add = async (): Promise<void> => {
    const digits = normalizeInboxNumber(number);
    if (digits === null) {
      setError(t("inbox.invalidNumber"));
      return;
    }
    // The backend keeps ONE row per number and does not overwrite that row's
    // note, so adding a number that is already here changes nothing. Say so
    // rather than letting the operator believe their note was saved.
    const known = entries.some((row) => row.number === digits);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const entry = await inboxAdd(digits, note.trim());
      setEntries((previous) => [entry, ...previous.filter((row) => row.id !== entry.id)]);
      setNumber("");
      if (known) setNotice(t("inbox.alreadyThere"));
      else setNote("");
    } catch (err) {
      setError(t("inbox.addFailed", { reason: describeError(err) }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await inboxRemove(id);
      setEntries((previous) => previous.filter((row) => row.id !== id));
    } catch (err) {
      setError(t("inbox.removeFailed", { reason: describeError(err) }));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      setEntries(await inboxRefresh());
    } catch (err) {
      setError(
        isMissingRegistryError(err)
          ? t("inbox.noRegistry")
          : t("inbox.refreshFailed", { reason: describeError(err) }),
      );
    } finally {
      setRefreshing(false);
    }
  };

  const connect = async (entry: InboxEntry): Promise<void> => {
    setConnecting(entry.id);
    setError("");
    setNotice("");
    try {
      let deviceId = entry.deviceId;
      if (deviceId === null) {
        // Nothing has been asked about this number yet, so ask now: only the
        // registry knows which device a number belongs to.
        const rows = await inboxRefresh();
        setEntries(rows);
        deviceId = rows.find((row) => row.id === entry.id)?.deviceId ?? null;
      }
      if (deviceId === null) {
        setError(t("inbox.numberNotRegistered"));
        return;
      }
      // One machine, one tile: a device that is already in the Library is
      // updated rather than saved a second time, so the operator does not
      // find the same computer twice.
      const existing = hosts.find((host) => host.protocol === "boundary" && host.address === deviceId);
      const saved = await saveHost({
        ...(existing ? { id: existing.id } : {}),
        // The number is the name the operator knows the machine by, and it is
        // the one thing in this row that is unique.
        friendlyName: existing?.friendlyName ?? entry.number,
        address: deviceId,
        port: 0,
        protocol: "boundary",
      });
      if (!saved) throw new Error(t("inbox.saveFailed"));
      await openSessionWindow({ profileId: saved.id });
    } catch (err) {
      setError(
        isMissingRegistryError(err)
          ? t("inbox.noRegistry")
          : t("inbox.connectFailed", { reason: describeError(err) }),
      );
    } finally {
      setConnecting(null);
    }
  };

  return (
    <>
      <button
        type="button"
        className="rounded-md border border-subtle px-3 py-1.5 text-sm text-primary hover:bg-inset"
        onClick={show}
        title={t("inbox.buttonTitle")}
      >
        {t("inbox.button")}
      </button>
      {/*
        The shared Dialog primitive, not a native <dialog>. A native one is in
        the TOP LAYER, and top-layer promotion does not reset `visibility`,
        which the pane grid uses to hide a background pane, so a native dialog
        opened while a background pane was hidden stayed modal and INVISIBLE.
        The shared primitive is gated on the pane being the visible one.
      */}
      {open ? (
        <Dialog
          title={t("inbox.title")}
          onClose={() => setOpen(false)}
          width={640}
          initialFocusSelector="#inbox-number"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="-mt-1 max-w-md flex-1 text-sm text-secondary">{t("inbox.intro")}</p>
              {/*
                The ONE place the registry is asked. It is a button and not a
                timer because the Worker's free plan has a daily request
                budget and the lookup is rate limited per address: a list
                that refreshed itself would spend that budget on a screen
                nobody is looking at.
              */}
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                {refreshing ? t("inbox.refreshing") : t("inbox.refresh")}
              </button>
            </div>
            <form
              className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <div className="flex flex-wrap gap-2">
                <label className="min-w-40 flex-1 text-sm">
                  {t("inbox.number")}
                  <input
                    id="inbox-number"
                    className="field mt-1"
                    value={number}
                    onChange={(event) => setNumber(event.target.value)}
                    placeholder={t("inbox.numberPlaceholder")}
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    dir="ltr"
                  />
                </label>
                <label className="min-w-40 flex-1 text-sm">
                  {t("inbox.note")}
                  <input
                    className="field mt-1"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t("inbox.notePlaceholder")}
                    autoComplete="off"
                    maxLength={120}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="btn-primary" disabled={busy}>
                  {t("inbox.add")}
                </button>
                <span className="text-xs text-secondary">{t("inbox.numberHint")}</span>
              </div>
            </form>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            {notice ? <p className="text-sm text-secondary">{notice}</p> : null}
            {entries.length === 0 ? (
              <p className="py-4 text-center text-sm text-secondary">{t("inbox.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {entries.map((entry) => (
                  <Row
                    key={entry.id}
                    entry={entry}
                    busy={busy}
                    connecting={connecting === entry.id}
                    canConnect={connecting === null}
                    checked={entry.lastCheckedAt ? timeAgo(entry.lastCheckedAt, t, lang) : null}
                    onConnect={() => void connect(entry)}
                    onRemove={() => void remove(entry.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

/** One number in the list: what it is, what the registry said, and the two acts. */
function Row({
  entry,
  busy,
  connecting,
  canConnect,
  checked,
  onConnect,
  onRemove,
}: {
  entry: InboxEntry;
  busy: boolean;
  connecting: boolean;
  canConnect: boolean;
  /** When the state was last refreshed, in the app's language. */
  checked: string | null;
  onConnect: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const look = inboxStateLook(entry.state);
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          The digits are a bidi-neutral run: in an Arabic line "250 739 098"
          would be laid out right to left. The run is isolated and pinned LTR
          so the digits stay in the order they are in.
        */}
        <span
          dir="ltr"
          style={{ unicodeBidi: "isolate" }}
          className="mono select-all text-sm font-medium text-primary"
        >
          {entry.number}
        </span>
        <span
          className={classNames(
            "rounded-full border px-2 py-0.5 text-2xs",
            TONE_CLASS[look.tone],
          )}
        >
          {t(look.labelKey)}
        </span>
        <span className="ms-auto text-xs text-secondary">
          {checked === null ? t("inbox.neverChecked") : t("inbox.checkedAt", { when: checked })}
        </span>
      </div>
      {entry.note ? <p className="text-sm text-secondary">{entry.note}</p> : null}
      <p className="text-xs text-secondary">{t(look.detailKey)}</p>
      {/*
        The shell's own sentence is shown only when it carries something our
        own wording cannot: the reason a lookup failed. For the other states
        it only repeats what the line above already says.
      */}
      {entry.state === "error" && entry.detail ? (
        <p className="text-xs text-secondary">{entry.detail}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={!canConnect}
          onClick={onConnect}
        >
          {connecting ? t("inbox.connecting") : t("inbox.connect")}
        </button>
        <button
          type="button"
          className="btn-secondary ms-auto"
          disabled={busy}
          title={t("inbox.removeTitle")}
          onClick={onRemove}
        >
          {t("inbox.remove")}
        </button>
      </div>
    </li>
  );
}
