/** Small shared utilities: color hashing, formatting, fuzzy matching, mnemonics. */
import type { Lang, Translate } from "./i18n";

/**
 * A failure, as a sentence to show a person.
 *
 * A Tauri command that returns `Result<_, String>` rejects with that string
 * rather than with an `Error`, so `err.message` is `undefined` for a failure
 * that had a message all along. Every call site that wants to say what went
 * wrong goes through here, which is also why it lives in one place instead of
 * being copied into each component.
 */
export function describeError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err === null || err === undefined) return "Something went wrong";
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Deterministic pleasant hue from a host id, used for icon-placeholder tiles. */
export function colorFromId(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  return `oklch(0.55 0.11 ${hue})`;
}

/**
 * How long ago something happened, in the app's language.
 *
 * The sentence comes from `Intl.RelativeTimeFormat`, in the language the app
 * is in: a library that says "3m ago" to somebody whose whole interface is
 * in Arabic is a library that has not been translated, and the app's default
 * language IS Arabic. The one thing Intl cannot say is the "never" that
 * stands for a host that has never been connected, and that is in the
 * catalogue with everything else.
 */
export function timeAgo(ts: number | null, t: Translate, lang: Lang): string {
  if (!ts) return t("util.never");
  const seconds = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (seconds < 60) return relative.format(-seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return relative.format(-days, "day");
  const months = Math.floor(days / 30);
  if (months < 12) return relative.format(-months, "month");
  return relative.format(-Math.floor(months / 12), "year");
}

export function formatBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} Gb/s`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mb/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} kb/s`;
  return `${bps.toFixed(0)} b/s`;
}

export interface FuzzyResult {
  score: number;
  /** indices of matched characters in the haystack (for highlighting) */
  positions: number[];
}

/** Simple subsequence fuzzy matcher; higher score = better. Null if no match. */
export function fuzzyMatch(query: string, haystack: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const h = haystack.toLowerCase();
  if (q.length === 0) return { score: 0, positions: [] };
  let qi = 0;
  let score = 0;
  let streak = 0;
  const positions: number[] = [];
  for (let hi = 0; hi < h.length && qi < q.length; hi++) {
    if (h[hi] === q[qi]) {
      positions.push(hi);
      streak += 1;
      score += 1 + streak * 2;
      // bonus for word-boundary matches
      if (hi === 0 || h[hi - 1] === " " || h[hi - 1] === "-" || h[hi - 1] === ".") {
        score += 6;
      }
      qi++;
    } else {
      streak = 0;
    }
  }
  if (qi < q.length) return null;
  // prefer shorter haystacks
  score -= Math.floor(h.length / 8);
  return { score, positions };
}

const MNEMONIC_WORDS = [
  "amber", "anchor", "apple", "arrow", "aspen", "atlas", "badge", "bamboo",
  "basil", "beacon", "berry", "birch", "bison", "blaze", "breeze", "brook",
  "cabin", "camel", "candle", "canyon", "cedar", "cello", "cherry", "cliff",
  "clover", "cobalt", "comet", "coral", "cosmos", "crane", "creek", "crystal",
  "dawn", "delta", "denim", "drift", "eagle", "ember", "falcon", "fern",
  "flint", "forest", "fox", "garnet", "geyser", "glacier", "grove", "harbor",
  "hazel", "heron", "hollow", "ivory", "jade", "jasper", "juniper", "kelp",
  "lagoon", "lantern", "lark", "lava", "lilac", "linen", "lotus", "lunar",
  "maple", "marble", "meadow", "mesa", "mint", "mirror", "moss", "mountain",
  "nectar", "north", "oak", "ocean", "olive", "onyx", "opal", "orchid",
  "otter", "owl", "pearl", "pebble", "pine", "plume", "prairie", "prism",
  "quartz", "quill", "raven", "reef", "ridge", "river", "robin", "rose",
  "saffron", "sage", "salmon", "sand", "sequoia", "shadow", "shore", "sierra",
  "silver", "sky", "slate", "smoke", "sparrow", "spruce", "star", "stone",
  "storm", "summit", "sunset", "swan", "thistle", "thunder", "tiger", "topaz",
  "trail", "tulip", "tundra", "valley", "velvet", "violet", "walnut", "willow",
] as const;

/**
 * Derive a 4-word mnemonic from a hex SHA-256 fingerprint so humans can compare
 * certificates over the phone. Uses the first 28 bits (7 bits per word).
 */
export function fingerprintMnemonic(fingerprintHex: string): string {
  const hex = fingerprintHex.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length < 8) return "";
  const bits = parseInt(hex.slice(0, 8), 16);
  const words: string[] = [];
  for (let i = 0; i < 4; i++) {
    words.push(MNEMONIC_WORDS[(bits >>> (i * 7)) & 0x7f]);
  }
  return words.join("-");
}

/** Group fingerprint hex into byte pairs: "AB:CD:EF:…" */
export function formatFingerprint(fp: string): string {
  const hex = fp.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length === 0) return fp;
  return hex.match(/.{1,2}/g)?.join(":") ?? fp;
}

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const isMac: boolean =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Platform modifier label: ⌘ on macOS, Ctrl elsewhere. */
export const modKeyLabel: string = isMac ? "⌘" : "Ctrl";

/**
 * The fullscreen shortcut, written once so nothing can advertise a chord the
 * app does not answer to. The accelerator lives on the View menu item in
 * `menu.rs`: F11 on Windows and Linux, ⌘⌃F on macOS. The toolbar button used
 * to claim Ctrl/⌘+⌥+Enter, which was never bound anywhere and went to the
 * remote desktop instead (issue #1).
 */
export const fullscreenHint: string = isMac ? "⌘⌃F" : "F11";
