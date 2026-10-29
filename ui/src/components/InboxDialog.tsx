import { useRef, useState, type ReactNode } from "react";
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
  withoutRemoved,
  type InboxTone,
} from "../lib/inbox";
import type { InboxEntry } from "../lib/types";
import { useI18n, useLang, useT } from "../lib/i18n";
import { useHosts } from "../state/HostsContext";
import { classNames, timeAgo } from "../lib/util";

/** How each tone is drawn. The words are in the catalogue; the colour is here. */
const TONE_CLASS: Record<InboxTone, string> = {
  muted: "border-subtle text-secondary",
  good: "border-success text-success",
  warn: "border-warning text-warning",
  bad: "border-danger text-danger",
};

/**
 * What one row is doing, and what went wrong on it.
 *
 * A row does one thing at a time: connecting and removing are two acts on
 * the same machine, and both at once would leave the row saying something
 * nobody can act on. Two DIFFERENT rows are free to be worked on at the same
 * time, which is why this is per row and not one flag for the whole list.
 */
interface RowState {
  /** The act this row is in the middle of. */
  work: "connecting" | "removing" | null;
  /** Why the last act on this row failed, if it did. */
  error: string | null;
}

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
  /** What the form or the registry button could not do. */
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Why the number in the box is not a device number yet. */
  const [fieldError, setFieldError] = useState("");
  /** Whether the list could be read at all. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** The form is adding a number right now. */
  const [adding, setAdding] = useState(false);
  /** The registry is being asked right now. */
  const [refreshing, setRefreshing] = useState(false);
  /** What each row is doing, and what went wrong on it. */
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  /** The row waiting to be confirmed before it goes. */
  const [removing, setRemoving] = useState<InboxEntry | null>(null);
  /**
   * The numbers that have been removed.
   *
   * A remove and a refresh are two separate requests, and the answer that
   * arrives last is not necessarily the newer truth: without this, a refresh
   * that was already on its way would put a removed number back on the
   * screen, and the person would be looking at a row they had just deleted.
   */
  const gone = useRef(new Set<string>());

  /** Change what one row is doing, or what went wrong on it. */
  const updateRow = (id: string, patch: Partial<RowState>): void => {
    setRowStates((previous) => {
      const current = previous[id] ?? { work: null, error: null };
      return { ...previous, [id]: { ...current, ...patch } };
    });
  };

  /** Forget a row that has left the list. */
  const clearRow = (id: string): void => {
    setRowStates((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  /** The rows as the list shows them. */
  const applyRows = (rows: InboxEntry[]): void => {
    setEntries(withoutRemoved(rows, gone.current));
  };

  const show = (): void => {
    setOpen(true);
    setError("");
    setNotice("");
    setFieldError("");
    setLoadFailed(false);
    void inboxList()
      .then(applyRows)
      .catch((err: unknown) => {
        // The technical reason goes to the log and not to the operator: the
        // backend speaks in English sentences about tables and columns, and
        // the person in front of this window speaks about their clients.
        console.error("[inbox] the list could not be read:", err);
        // A list that could not be READ is not a list that is EMPTY, and it
        // must never be shown as if it were: an empty list is something a
        // person acts on, and a list that could not be read is something they
        // have to try again.
        setEntries([]);
        setLoadFailed(true);
      });
  };

  /**
   * The number in the box, and whether it is a device number yet.
   *
   * The complaint goes away as soon as the text is a number again, but the
   * text itself is never taken away: a person who mistyped a digit fixes the
   * digit, they do not retype the whole number.
   */
  const onNumber = (value: string): void => {
    setNumber(value);
    if (fieldError !== "" && normalizeInboxNumber(value) !== null) setFieldError("");
  };

  const add = async (): Promise<void> => {
    const digits = normalizeInboxNumber(number);
    if (digits === null) {
      setFieldError(t("inbox.invalidNumber"));
      return;
    }
    setFieldError("");
    // The backend keeps ONE row per number and does not overwrite that row's
    // note, so adding a number that is already here changes nothing. Say so
    // rather than letting the operator believe their note was saved.
    const known = entries.some((row) => row.number === digits);
    // What was submitted, so that only THAT is cleared afterwards: a person
    // who typed another number while the write was in flight keeps it.
    const submitted = number;
    const submittedNote = note;
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const entry = await inboxAdd(digits, note.trim());
      setEntries((previous) => [entry, ...previous.filter((row) => row.id !== entry.id)]);
      if (known) {
        // Nothing was written, so nothing is cleared: the number and the note
        // stay in their boxes. Clearing the number alone would have left the
        // note with nothing to belong to.
        setNotice(t("inbox.alreadyThere"));
      } else {
        setNumber((current) => (current === submitted ? "" : current));
        setNote((current) => (current === submittedNote ? "" : current));
      }
    } catch (err) {
      console.error("[inbox] the number could not be added:", err);
      setError(t("inbox.addFailed"));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (entry: InboxEntry): Promise<void> => {
    updateRow(entry.id, { work: "removing", error: null });
    try {
      await inboxRemove(entry.id);
      gone.current.add(entry.id);
      setEntries((previous) => withoutRemoved(previous, gone.current));
      // The row has left the list, so its state goes with it.
      clearRow(entry.id);
    } catch (err) {
      console.error("[inbox] the number could not be removed:", err);
      // The row is still there: it keeps its place in the list, with the
      // work cleared and the reason written on it.
      updateRow(entry.id, { work: null, error: t("inbox.removeFailed") });
    }
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      applyRows(await inboxRefresh());
    } catch (err) {
      console.error("[inbox] the registry could not be asked:", err);
      setError(
        isMissingRegistryError(err) ? t("inbox.noRegistry") : t("inbox.refreshFailed"),
      );
    } finally {
      setRefreshing(false);
    }
  };

  const connect = async (entry: InboxEntry): Promise<void> => {
    updateRow(entry.id, { work: "connecting", error: null });
    try {
      let deviceId = entry.deviceId;
      if (deviceId === null) {
        // Nothing has been asked about this number yet, so ask now: only the
        // registry knows which device a number belongs to.
        const rows = await inboxRefresh();
        applyRows(rows);
        deviceId = rows.find((row) => row.id === entry.id)?.deviceId ?? null;
      }
      if (deviceId === null) {
        updateRow(entry.id, { work: null, error: t("inbox.numberNotRegistered") });
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
      if (!saved) {
        updateRow(entry.id, { work: null, error: t("inbox.saveFailed") });
        return;
      }
      await openSessionWindow({ profileId: saved.id });
      updateRow(entry.id, { work: null });
    } catch (err) {
      console.error("[inbox] the connection failed:", err);
      updateRow(entry.id, {
        work: null,
        error: isMissingRegistryError(err) ? t("inbox.noRegistry") : t("inbox.connectFailed"),
      });
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
        The shared primitive is gated on the pane being the visible one, and
        it brings the Escape handling and the focus trap with it.

        The confirmation REPLACES this window rather than stacking on it: two
        Dialogs at once would both answer an Escape, and the one underneath
        would close with the one on top.
      */}
      {open ? (
        removing ? (
          <RemoveConfirmDialog
            entry={removing}
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              const entry = removing;
              setRemoving(null);
              void remove(entry);
            }}
          />
        ) : (
          <Dialog
            title={t("inbox.title")}
            onClose={() => setOpen(false)}
            width={640}
            // The number is the only field most people come here to fill in.
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
                  {/*
                    The label is bound with `for` and not by wrapping the
                    field: a wrapping label takes its own text as the field's
                    name, and the complaint about the number would then be
                    part of the name the screen reader reads out.
                  */}
                  <div className="min-w-40 flex-1 text-sm">
                    <label htmlFor="inbox-number" className="block">
                      {t("inbox.number")}
                    </label>
                    <input
                      id="inbox-number"
                      className="field mt-1"
                      value={number}
                      onChange={(event) => onNumber(event.target.value)}
                      placeholder={t("inbox.numberPlaceholder")}
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      dir="ltr"
                      aria-invalid={fieldError !== ""}
                      aria-describedby={fieldError !== "" ? "inbox-number-error" : undefined}
                    />
                    {fieldError !== "" ? (
                      <p id="inbox-number-error" role="alert" className="mt-1 text-xs text-danger">
                        {fieldError}
                      </p>
                    ) : null}
                  </div>
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
                  <button type="submit" className="btn-primary" disabled={adding}>
                    {adding ? t("inbox.adding") : t("inbox.add")}
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
              {loadFailed ? (
                /*
                  A list that could not be read. It is drawn in the danger
                  colour and it says so in words, because it is NOT the empty
                  list: the empty list is a place a person adds a number, and
                  this one is a thing that has to be tried again.
                */
                <div className="rounded-lg border border-danger/40 bg-danger-subtle p-4 text-center">
                  <p className="text-sm font-medium text-danger">{t("inbox.listFailed")}</p>
                  <p className="mt-1 text-xs text-secondary">{t("inbox.listFailedHint")}</p>
                  <button type="button" className="btn-secondary mt-3" onClick={show}>
                    {t("inbox.retryRead")}
                  </button>
                </div>
              ) : entries.length === 0 ? (
                <div className="rounded-lg border border-subtle p-6 text-center">
                  <p className="text-sm text-secondary">{t("inbox.empty")}</p>
                  <p className="mt-1 text-xs text-tertiary">{t("inbox.emptyHint")}</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2" aria-label={t("inbox.listAria")}>
                  {entries.map((entry) => (
                    <Row
                      key={entry.id}
                      entry={entry}
                      state={rowStates[entry.id]}
                      checked={entry.lastCheckedAt ? timeAgo(entry.lastCheckedAt, t, lang) : null}
                      onConnect={() => void connect(entry)}
                      onRemove={() => setRemoving(entry)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </Dialog>
        )
      ) : null}
    </>
  );
}

/**
 * The confirmation before a number leaves the inbox.
 *
 * The shared Dialog primitive in its `danger` variant, the same shape as the
 * certificate prompt's hard stop: the question is the title, the number is
 * the body, and the focus starts on Cancel so that a person who reached for
 * the keyboard is not one keystroke away from the delete.
 *
 * The number's note goes with it — the backend keeps one row per number, and
 * that row holds the operator's own words about their client. So the note is
 * named in the question rather than left for the person to remember.
 */
function RemoveConfirmDialog({
  entry,
  onConfirm,
  onCancel,
}: {
  entry: InboxEntry;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactNode {
  const t = useT();
  return (
    <Dialog
      title={t("inbox.removeConfirmTitle")}
      onClose={onCancel}
      danger
      width={420}
      initialFocusSelector="[data-cancel]"
    >
      <div className="space-y-3">
        <div className="rounded-md border border-subtle bg-inset px-3 py-2 text-center">
          {/*
            The digits are a bidi-neutral run, so they are isolated and pinned
            LTR: in an Arabic line "250739098" would otherwise be laid out
            right to left.
          */}
          <span
            dir="ltr"
            style={{ unicodeBidi: "isolate" }}
            className="mono select-all text-sm font-medium text-primary"
          >
            {entry.number}
          </span>
          {entry.note ? <p className="mt-1 text-xs text-secondary">{entry.note}</p> : null}
        </div>
        <p className="text-sm text-primary">{t("inbox.removeConfirmBody")}</p>
        <div className="flex justify-end gap-2.5">
          <button type="button" data-cancel className="btn-secondary" onClick={onCancel}>
            {t("host.cancel")}
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            {t("inbox.removeConfirmAction")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** One number in the list: what it is, what the registry said, and the two acts. */
function Row({
  entry,
  state,
  checked,
  onConnect,
  onRemove,
}: {
  entry: InboxEntry;
  /** What this row is doing, if it is doing anything. */
  state?: RowState;
  /** When the state was last refreshed, in the app's language. */
  checked: string | null;
  onConnect: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const look = inboxStateLook(entry.state);
  const work = state?.work ?? null;
  const error = state?.error ?? null;
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
        {/*
          The chip says the state in WORDS as well as in colour. A tone on
          its own is unreadable for somebody who cannot tell the colours
          apart, and the words are in the catalogue already.
        */}
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
          // One act at a time on this row. Another row is free to be worked on
          // at the same time: the busy state belongs to the row, not to the
          // list.
          disabled={work !== null}
          // The number is in the name, so that a screen reader reading the
          // buttons one after another says WHICH machine each one is about.
          aria-label={t("inbox.connectAria", { number: entry.number })}
          onClick={onConnect}
        >
          {work === "connecting" ? t("inbox.connecting") : t("inbox.connect")}
        </button>
        <button
          type="button"
          className="btn-secondary ms-auto"
          disabled={work !== null}
          aria-label={t("inbox.removeAria", { number: entry.number })}
          title={t("inbox.removeTitle")}
          onClick={onRemove}
        >
          {work === "removing" ? t("inbox.removing") : t("inbox.remove")}
        </button>
      </div>
      {/*
        The row that failed says so, and only that row: a message about one
        number does not belong above the whole list, where it would look like
        it was about all of them.
      */}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}
