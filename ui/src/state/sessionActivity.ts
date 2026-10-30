/**
 * Pure lookups over the live-session registry.
 *
 * The Library grid asks "what is happening on this host?" once per tile, and
 * the answer changes at 1 Hz per connected session. Scanning every session for
 * every tile, once a second, was the reason the grid could not stay still, so
 * the scan happens once per data change and produces a map that a tile reads in
 * one step. This module holds no React state on purpose: the map and the
 * freshness rule are testable without rendering anything.
 */
import { discoveredThumbKey } from "../lib/types";

export interface BandwidthSample {
  /** RX bits/sec. */
  rx: number;
  /** TX bits/sec. */
  tx: number;
}

/** No stats sample for this long ⇒ the bandwidth reading is not shown. */
export const STALE_MS = 3000;

/** The shape this module needs from a live session; `LiveSession` has more. */
export interface ActivitySession {
  profileId: string | null;
  address: string;
  port: number;
  /** Wall-clock ms of the newest stats sample; 0 = none yet. */
  lastStatsAt: number;
  latest: BandwidthSample | null;
  samples: readonly BandwidthSample[];
}

/** The shape this module needs from a stored preview frame. */
export interface ActivityPreview {
  dataUrl: string;
  width: number;
  height: number;
}

/** What a tile gets back for its key. */
export interface TileActivity {
  /**
   * Fresh bandwidth, or null. `expiresAt` is when the reading stops being
   * fresh, so a consumer can schedule its own re-render at that moment instead
   * of the provider ticking once a second for every tile.
   */
  bandwidth: {
    rx: number;
    tx: number;
    samples: readonly BandwidthSample[];
    expiresAt: number;
  } | null;
  /** Latest live preview frame for this key, else null. */
  preview: { dataUrl: string; width: number; height: number } | null;
}

/** The single shared empty answer, so tiles without activity keep one identity. */
export const EMPTY_ACTIVITY: TileActivity = { bandwidth: null, preview: null };

/** The tile key a session's data lands under, same convention as thumbnails. */
export function sessionKeyOf(s: {
  profileId: string | null;
  address: string;
  port: number;
}): string {
  return s.profileId ?? discoveredThumbKey(s.address, s.port);
}

/**
 * One activity entry per tile key.
 *
 * More than one session can map to one key (the "several windows per
 * computer" preference); the session with the newest stats speaks for the
 * tile. Freshness is judged against `now` so the caller decides when it was
 * computed, which is also what makes this testable.
 */
export function buildActivityLookup(
  sessions: readonly ActivitySession[],
  previews: Readonly<Record<string, ActivityPreview>>,
  now: number,
): Map<string, TileActivity> {
  const best = new Map<string, ActivitySession>();
  for (const s of sessions) {
    const key = sessionKeyOf(s);
    const current = best.get(key);
    if (!current || s.lastStatsAt > current.lastStatsAt) best.set(key, s);
  }

  const lookup = new Map<string, TileActivity>();
  for (const [key, s] of best) {
    const latest = s.latest;
    const fresh = latest !== null && now - s.lastStatsAt <= STALE_MS;
    const bandwidth = fresh
      ? {
          rx: latest.rx,
          tx: latest.tx,
          samples: s.samples,
          expiresAt: s.lastStatsAt + STALE_MS,
        }
      : null;
    // A preview is only live while its session still exists; `ended` (and this
    // guard, for a missed event) keeps closed sessions off tiles.
    const frame = previews[key];
    const preview = frame
      ? { dataUrl: frame.dataUrl, width: frame.width, height: frame.height }
      : null;
    if (bandwidth || preview) lookup.set(key, { bandwidth, preview });
  }
  return lookup;
}

/**
 * Is this the same answer a tile would render?
 *
 * The provider notifies a tile only when its own answer changed, and the map is
 * rebuilt on every frame, so object identity cannot be the test: two builds
 * with nothing new must compare equal. Samples are compared by reference
 * because the session state keeps them immutable.
 */
export function sameActivity(a: TileActivity | undefined, b: TileActivity | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.preview?.dataUrl === b.preview?.dataUrl &&
    a.preview?.width === b.preview?.width &&
    a.preview?.height === b.preview?.height &&
    a.bandwidth?.rx === b.bandwidth?.rx &&
    a.bandwidth?.tx === b.bandwidth?.tx &&
    a.bandwidth?.samples === b.bandwidth?.samples &&
    a.bandwidth?.expiresAt === b.bandwidth?.expiresAt
  );
}
