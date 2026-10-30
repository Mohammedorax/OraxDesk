/**
 * What the registry knows about THIS computer, for the number in the top bar.
 *
 * The card answers one question a customer asks out loud — "can somebody reach
 * me by this number?" — and it must never answer more than it knows. This
 * build has no presence signal for a machine it has not connected to (see
 * `docs/CUSTOMER-SETUP.md`), so there is no "online" and no "offline" here:
 * only what the registry holds and what this machine has published.
 *
 * The state is read on demand and only on demand. The registry's free plan has
 * a daily request budget and the lookup is rate limited per address, so nothing
 * here runs on a timer: `checkDeviceStatus` is called once per click of the
 * card's own check button.
 */
import type { MessageKey } from "./i18n";
import { registry, type SupportView } from "./support";
import { inTauri, safeInvoke } from "./tauri";

/**
 * The states this build can tell apart.
 *
 * `published` is the registry having an address for this computer, which is
 * what "a helper can dial it" means; `no-address` is registered without one.
 * `revoked` is the registry refusing this device, which is the one state nobody
 * on this machine can fix from here. `unknown` is the registry not answering:
 * it is NOT the same thing as `unchecked`, which is nobody having asked yet.
 */
export type DeviceStatus =
  | "unchecked"
  | "published"
  | "no-address"
  | "revoked"
  | "not-registered"
  | "unknown";

/** Every state, for the tests that hold the catalogue to this list. */
export const DEVICE_STATUSES: readonly DeviceStatus[] = [
  "unchecked",
  "published",
  "no-address",
  "revoked",
  "not-registered",
  "unknown",
];

/** How a state is coloured. The words are in the catalogue; the colour is here. */
export type DeviceTone = "muted" | "good" | "warn" | "bad";

/** The catalogue keys this module owns; a typo is a compile error. */
export type DeviceStatusKey = Extract<MessageKey, `device.status.${string}`>;

export interface DeviceStatusLook {
  /** The sentence under the number. It carries the meaning on its own. */
  labelKey: DeviceStatusKey;
  /** The colour of the strip on the card's inline-start edge. */
  tone: DeviceTone;
}

const LOOKS: Record<DeviceStatus, DeviceStatusLook> = {
  unchecked: { labelKey: "device.status.unchecked", tone: "muted" },
  published: { labelKey: "device.status.published", tone: "good" },
  "no-address": { labelKey: "device.status.noAddress", tone: "warn" },
  revoked: { labelKey: "device.status.revoked", tone: "bad" },
  "not-registered": { labelKey: "device.status.notRegistered", tone: "warn" },
  unknown: { labelKey: "device.status.unknown", tone: "muted" },
};

export function deviceStatusLook(status: DeviceStatus): DeviceStatusLook {
  return LOOKS[status];
}

/**
 * The strip's colour per tone.
 *
 * A strip alone is not a status: colour is unreadable to some people and the
 * card always says the state in words beside it. This is the second carrier,
 * never the only one.
 */
export const DEVICE_TONE_CLASS: Record<DeviceTone, string> = {
  muted: "bg-tertiary",
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-danger",
};

/**
 * Is this the registry saying it does not know the number, rather than failing?
 *
 * The Worker answers an unknown number with 404 and a `not_found` code, and
 * "this number is not registered" and "the registry did not answer" are two
 * different problems with two different fixes.
 */
function isNotRegistered(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /404|not_found|no such device/i.test(text);
}

/**
 * Ask, once, what the registry holds for this computer and whether this
 * machine has published an address.
 *
 * Both halves are needed and neither is a substitute for the other: the
 * registry is the only place a revocation is recorded, and the address is
 * published by the unattended listener on this machine, so the shell already
 * knows whether it is up without asking anybody (see `support://state`).
 */
export async function checkDeviceStatus(number: string): Promise<DeviceStatus> {
  if (!inTauri()) return "unchecked";
  try {
    const origin = await registry.origin();
    const [view, record] = await Promise.all([
      safeInvoke<SupportView | null>("support_state", undefined, null),
      registry.lookupNumber(origin, number),
    ]);
    if (record.revoked_at !== null) return "revoked";
    return view?.unattended.reachable === true ? "published" : "no-address";
  } catch (err) {
    return isNotRegistered(err) ? "not-registered" : "unknown";
  }
}
