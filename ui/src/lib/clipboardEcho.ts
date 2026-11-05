/**
 * The text the session's clipboard sync last moved, in either direction.
 *
 * Neither automatic half of the sync may repeat itself: without this, text
 * copied on the remote is written to the local clipboard and then pushed
 * straight back the next time the window is focused.
 *
 * What it remembers belongs to one connection. A reconnect is a new
 * connection, and over RDP a new connection is a new clipboard channel that
 * starts empty: the server asks for our formats again and is told there are
 * none. Remembering across it made the first push after the reconnect look
 * like a repeat, so it was skipped, and pasting on the remote gave nothing
 * until the user copied something new locally (issue #9).
 */
export class ClipboardEcho {
  private last: string | null = null;
  private epoch = 0;
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();

  /** A connection (first or reconnect) came up: forget what was moved. */
  connected(): void {
    this.epoch += 1;
    this.revision += 1;
    this.last = null;
    this.tail = Promise.resolve();
  }

  /** Record text moved in either direction. */
  moved(text: string): void {
    this.last = text;
    this.revision += 1;
  }

  /**
   * Whether a push of `text` is worth sending. Empty text never is; an
   * explicit push (`force`) always is otherwise.
   */
  shouldPush(text: string, force: boolean): boolean {
    if (!text) return false;
    return force || text !== this.last;
  }

  /** Serialize sends and remember text only after the backend accepts it. */
  push(text: string, force: boolean, send: (text: string) => Promise<void>): Promise<boolean> {
    const epoch = this.epoch;
    const operation = this.tail.then(async () => {
      if (epoch !== this.epoch || !this.shouldPush(text, force)) return false;
      const revision = this.revision;
      await send(text);
      if (epoch !== this.epoch) return false;
      // A remote clipboard event that arrived during the send is newer.
      if (revision === this.revision) this.moved(text);
      return true;
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
