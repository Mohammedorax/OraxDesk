/**
 * Live-session registry for the Library window (main window only).
 *
 * The composed framebuffer only exists in each session window's WebGL texture,
 * and the bandwidth counters only exist in Rust, so this context is the
 * Library's one ear on both: it seeds from `list_active_sessions`, then keeps
 * itself current from three app-wide events:
 *
 *   `sessions://event`, session lifecycle (started / state / ended), Rust
 *   `sessions://stats`, 1 Hz per connected session, Rust
 *   `library://preview`, ~2 fps JPEG data-URL frames, emitted by the session
 *                          window's JS (see hooks/useLivePreview.ts)
 *
 * Tiles look themselves up by the SAME key the thumbnail store uses: a saved
 * host's profile id, or `discovered:<address>:<port>` for an ad-hoc session
 * (see `sessionKeyOf` in `state/sessionActivity.ts`).
 *
 * The registry is a per-key subscription store rather than a plain context
 * value. A context value has to change for any consumer to see new data, so
 * one session's stats tick used to re-render the whole Library grid, and one
 * preview frame used to re-render every tile in it. Here a tile subscribes to
 * its own key and wakes only when its own answer changed; the frames for keys
 * nobody is watching are dropped at the door.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { emit } from "@tauri-apps/api/event";
import type { ProtocolKind, SessionStats } from "../lib/types";
import { isProtocolKind } from "../lib/types";
import { inTauri, safeInvoke, safeListen } from "../lib/tauri";
import {
  EMPTY_ACTIVITY,
  buildActivityLookup,
  sameActivity,
  type ActivityPreview,
  type BandwidthSample,
  type TileActivity,
} from "./sessionActivity";

// ---------------------------------------------------------------- contracts

/** Rust KV key for the Library's live-previews toggle ("1" / "0", default off). */
export const LIVE_PREVIEWS_KEY = "livePreviews";
/** App-wide JS event the Library emits when the toggle changes: `{ enabled }`. */
export const LIVE_PREVIEWS_EVENT = "library://live-previews";
/** App-wide JS event carrying one downscaled preview frame per publish tick. */
export const PREVIEW_EVENT = "library://preview";

const SESSIONS_EVENT = "sessions://event";
const SESSIONS_STATS_EVENT = "sessions://stats";

/** Ring buffer length: ~60 s of 1 Hz samples per session. */
const MAX_SAMPLES = 60;

/** Payload of `library://preview` (JS → JS, emitted from the session window). */
export interface PreviewPayload {
  sessionId: string;
  /** profileId if the session has one, else `discovered:<address>:<port>`. */
  key: string;
  address: string;
  port: number;
  /** "data:image/jpeg;base64,…", downscaled to ≤360 px wide. */
  dataUrl: string;
  width: number;
  height: number;
}

/** Flat payloads of `sessions://event` (Rust `app.emit`, camelCase). */
type SessionsEventPayload =
  | { type: "started"; sessionId: string; profileId: string | null; address: string; port: number }
  | { type: "state"; sessionId: string; state: string }
  | { type: "ended"; sessionId: string };

/** Payload of `sessions://stats`, top-level camelCase, `stats` snake_case. */
interface SessionsStatsPayload {
  sessionId: string;
  profileId: string | null;
  address: string;
  port: number;
  stats: SessionStats;
}

/** One row of `list_active_sessions`. */
interface ActiveSessionRow {
  sessionId: string;
  profileId: string | null;
  address: string;
  port: number;
  /** Optional because an older shell sends no such key. */
  protocol?: ProtocolKind;
}

// ------------------------------------------------------------------- state

interface LiveSession {
  sessionId: string;
  profileId: string | null;
  address: string;
  port: number;
  protocol: ProtocolKind;
  /** Kebab-case state tag ("connecting", "connected", …). */
  state: string;
  /** Last ~60 s of 1 Hz throughput samples, oldest first. */
  samples: BandwidthSample[];
  latest: BandwidthSample | null;
  totals: { bytesReceived: number; bytesSent: number } | null;
  /** Wall-clock ms of the newest stats sample; 0 = none yet. */
  lastStatsAt: number;
}

interface PreviewFrame extends ActivityPreview {
  sessionId: string;
}

/**
 * The subscription surface a tile uses.
 *
 * `read` is a snapshot and `subscribe` hears only about this key; the event
 * intake asks the same registry which keys are on screen.
 */
interface SessionStore {
  read: (key: string) => TileActivity;
  subscribe: (key: string, listener: () => void) => () => void;
}

const SessionStoreContext = createContext<SessionStore | null>(null);

interface LivePreviewsValue {
  /** The persisted Library toggle (default off). */
  livePreviews: boolean;
  /** Flip the toggle: persists it and broadcasts `library://live-previews`. */
  setLivePreviews: (enabled: boolean) => void;
}

const LivePreviewsContext = createContext<LivePreviewsValue | null>(null);

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function blankSession(row: ActiveSessionRow, state: string): LiveSession {
  return {
    sessionId: row.sessionId,
    // Carried so a tile can show which protocol is live on it. The tile KEY
    // deliberately does not change: two protocols to one machine use
    // different ports, so `discovered:<address>:<port>` is already distinct
    // and a VNC and an RDP session to one box get two tiles, which is
    // correct, they are two different things to look at.
    protocol: isProtocolKind(row.protocol) ? row.protocol : "vnc",
    profileId: typeof row.profileId === "string" && row.profileId ? row.profileId : null,
    address: typeof row.address === "string" ? row.address : "",
    port: num(row.port) || 5900,
    state,
    samples: [],
    latest: null,
    totals: null,
    lastStatsAt: 0,
  };
}

// ---------------------------------------------------------------- provider

export function SessionsProvider({ children }: { children: ReactNode }): ReactNode {
  const [sessions, setSessions] = useState<Record<string, LiveSession>>({});
  const [previews, setPreviews] = useState<Record<string, PreviewFrame>>({});

  // ------------------------------------------------------- live-previews toggle

  const [livePreviews, setLivePreviewsState] = useState(false);
  /**
   * Set as soon as the person touches the switch.
   *
   * The stored value is read once, on mount, and the read lands whenever it
   * lands. If the switch was turned OFF in the meantime, the read would turn
   * it back ON, because the read only ever set it to true. The flag says
   * "the person has already decided", and the read then leaves it alone.
   */
  const livePreviewsChosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void safeInvoke<string | null>("get_app_setting", { key: LIVE_PREVIEWS_KEY }, null).then(
      (raw) => {
        if (cancelled || livePreviewsChosen.current) return;
        if (raw === "1") setLivePreviewsState(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const setLivePreviews = useCallback((enabled: boolean): void => {
    livePreviewsChosen.current = true;
    setLivePreviewsState(enabled);
    void safeInvoke("set_app_setting", { key: LIVE_PREVIEWS_KEY, value: enabled ? "1" : "0" }, null);
    // Session windows read the setting once at startup and listen for this
    // broadcast thereafter (item 6 of the live-thumbs contract).
    if (inTauri()) {
      void emit(LIVE_PREVIEWS_EVENT, { enabled }).catch((err: unknown) => {
        console.warn(`[sessions] emit "${LIVE_PREVIEWS_EVENT}" failed:`, err);
      });
    }
  }, []);

  const livePreviewsValue = useMemo(
    () => ({ livePreviews, setLivePreviews }),
    [livePreviews, setLivePreviews],
  );

  // ------------------------------------------------------------ event intake

  const onEvent = useCallback((ev: SessionsEventPayload): void => {
    if (!ev || typeof ev !== "object" || typeof ev.sessionId !== "string" || !ev.sessionId) return;
    switch (ev.type) {
      case "started":
        // A seed row or an earlier stats event may already have the entry;
        // never wipe accumulated samples with a blank.
        setSessions((prev) =>
          prev[ev.sessionId]
            ? prev
            : { ...prev, [ev.sessionId]: blankSession(ev, "connecting") },
        );
        break;
      case "state":
        setSessions((prev) => {
          const cur = prev[ev.sessionId];
          if (!cur || typeof ev.state !== "string" || cur.state === ev.state) return prev;
          return { ...prev, [ev.sessionId]: { ...cur, state: ev.state } };
        });
        break;
      case "ended":
        setSessions((prev) => {
          if (!(ev.sessionId in prev)) return prev;
          const next = { ...prev };
          delete next[ev.sessionId];
          return next;
        });
        // Drop the session's frozen last frame too, or a closed session would
        // leave its tile stuck on a stale "live" picture.
        setPreviews((prev) => {
          const keep = Object.entries(prev).filter(([, p]) => p.sessionId !== ev.sessionId);
          return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep);
        });
        break;
      default:
        break;
    }
  }, []);

  const onStats = useCallback((ev: SessionsStatsPayload): void => {
    if (!ev || typeof ev !== "object" || typeof ev.sessionId !== "string" || !ev.sessionId) return;
    if (!ev.stats || typeof ev.stats !== "object") return;
    const sample: BandwidthSample = {
      rx: num(ev.stats.throughput_bps),
      tx: num(ev.stats.throughput_up_bps),
    };
    const now = Date.now();
    setSessions((prev) => {
      // Stats can outrun the seed and the `started` event, upsert.
      const cur = prev[ev.sessionId] ?? blankSession(ev, "connected");
      const samples = [...cur.samples, sample];
      if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
      return {
        ...prev,
        [ev.sessionId]: {
          ...cur,
          // Stats only flow while connected; a missed state event must not
          // leave the entry stuck on "connecting".
          state: "connected",
          samples,
          latest: sample,
          totals: {
            bytesReceived: num(ev.stats.bytes_received),
            bytesSent: num(ev.stats.bytes_sent),
          },
          lastStatsAt: now,
        },
      };
    });
  }, []);

  // ------------------------------------------------------------ subscriptions

  const watchers = useRef(new Map<string, Set<() => void>>());
  /**
   * The switch, read by the event intake.
   *
   * With live previews off a tile does not render a frame, so storing one would
   * wake every subscribed tile for a picture nobody is showing. The session
   * windows stop publishing anyway; this is the second half of the same rule.
   */
  const previewsWanted = useRef(livePreviews);
  previewsWanted.current = livePreviews;
  const lookupRef = useRef<Map<string, TileActivity>>(new Map());

  const onPreview = useCallback((ev: PreviewPayload): void => {
    if (!ev || typeof ev !== "object") return;
    if (typeof ev.key !== "string" || !ev.key) return;
    // The data URL is rendered as an <img src>; accept only what the publisher
    // actually produces, never an arbitrary string from a stray event.
    if (typeof ev.dataUrl !== "string" || !ev.dataUrl.startsWith("data:image/")) return;
    if (!previewsWanted.current) return;
    // Nobody has this key on screen, so there is nothing to repaint and
    // nothing worth keeping: dropping the frame here is what stops a preview
    // for a host in a filtered-out group from re-rendering the grid.
    if (!watchers.current.has(ev.key)) return;
    setPreviews((prev) => ({
      // One stored frame per key, each publish replaces the last.
      ...prev,
      [ev.key]: {
        sessionId: typeof ev.sessionId === "string" ? ev.sessionId : "",
        dataUrl: ev.dataUrl,
        width: num(ev.width),
        height: num(ev.height),
      },
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const hook = <T,>(event: string, handler: (payload: T) => void): void => {
      void safeListen<T>(event, (payload) => {
        if (!cancelled) handler(payload);
      }).then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    };
    hook<SessionsEventPayload>(SESSIONS_EVENT, onEvent);
    hook<SessionsStatsPayload>(SESSIONS_STATS_EVENT, onStats);
    hook<PreviewPayload>(PREVIEW_EVENT, onPreview);

    // Seed with whatever is already connected (this window may have been
    // reopened mid-session). The command lands with the Rust side of this
    // feature; until then the safeInvoke fallback is just an empty seed.
    void safeInvoke<ActiveSessionRow[]>("list_active_sessions", undefined, []).then((rows) => {
      if (cancelled || !Array.isArray(rows)) return;
      setSessions((prev) => {
        let next = prev;
        for (const row of rows) {
          if (!row || typeof row.sessionId !== "string" || !row.sessionId) continue;
          if (next[row.sessionId]) continue; // an event got here first, keep it
          if (next === prev) next = { ...prev };
          next[row.sessionId] = blankSession(row, "connected");
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, [onEvent, onStats, onPreview]);

  // -------------------------------------------------------------- lookups

  // Built once per data change: the grid used to scan every session once per
  // tile per render, which is O(sessions × tiles) every second.
  const activities = useMemo(
    () => buildActivityLookup(Object.values(sessions), previews, Date.now()),
    [sessions, previews],
  );
  // Assigned during render, not in an effect, so a tile that mounts in the
  // same commit as a data change reads the new answer on its first render.
  lookupRef.current = activities;

  const store = useMemo<SessionStore>(
    () => ({
      read: (key) => {
        const entry = lookupRef.current.get(key);
        if (!entry) return EMPTY_ACTIVITY;
        // Freshness is judged at read time: the map was built a moment ago,
        // and a reading that has just gone stale must stop being shown without
        // waiting for another event from the session.
        if (entry.bandwidth !== null && entry.bandwidth.expiresAt <= Date.now()) {
          return entry.preview ? { bandwidth: null, preview: entry.preview } : EMPTY_ACTIVITY;
        }
        return entry;
      },
      subscribe: (key, listener) => {
        let set = watchers.current.get(key);
        if (!set) {
          set = new Set();
          watchers.current.set(key, set);
        }
        set.add(listener);
        return () => {
          const current = watchers.current.get(key);
          if (!current) return;
          current.delete(listener);
          if (current.size === 0) watchers.current.delete(key);
        };
      },
    }),
    [],
  );

  // Wake only the keys whose own answer changed. A stats tick for one session
  // must not repaint the other nineteen tiles, and a preview frame must not
  // repaint anything but the tile it belongs to.
  const previousActivities = useRef(activities);
  useEffect(() => {
    const before = previousActivities.current;
    previousActivities.current = activities;
    if (before === activities) return;
    const keys = new Set([...before.keys(), ...activities.keys()]);
    for (const key of keys) {
      if (sameActivity(before.get(key), activities.get(key))) continue;
      const set = watchers.current.get(key);
      if (!set) continue;
      for (const notify of set) notify();
    }
  }, [activities]);

  return (
    <SessionStoreContext.Provider value={store}>
      <LivePreviewsContext.Provider value={livePreviewsValue}>
        {children}
      </LivePreviewsContext.Provider>
    </SessionStoreContext.Provider>
  );
}

function useSessionStore(): SessionStore {
  const ctx = useContext(SessionStoreContext);
  if (!ctx) throw new Error("useSessions outside SessionsProvider");
  return ctx;
}

/** The Library's live-previews switch; separate so a frame cannot wake it. */
export function useLivePreviews(): LivePreviewsValue {
  const ctx = useContext(LivePreviewsContext);
  if (!ctx) throw new Error("useLivePreviews outside SessionsProvider");
  return ctx;
}

/**
 * What is happening on one tile, re-rendering only when its own answer changes.
 *
 * A reading that stops arriving expires on a timer this hook owns, so the
 * provider no longer has to tick once a second for everyone to notice.
 */
export function useTileActivity(key: string): TileActivity {
  const store = useSessionStore();
  const [activity, setActivity] = useState<TileActivity>(() => store.read(key));

  useEffect(() => {
    // Re-read on mount and on a key change, then follow only this key.
    setActivity(store.read(key));
    return store.subscribe(key, () => setActivity(store.read(key)));
  }, [store, key]);

  const expiresAt = activity.bandwidth?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const id = window.setTimeout(
      () => setActivity(store.read(key)),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [store, key, expiresAt]);

  return activity;
}
