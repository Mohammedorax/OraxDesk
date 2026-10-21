import { nowSeconds } from "./encoding";
import type { Env } from "./env";

export interface SweepResult {
  codes: number;
  nonces: number;
  audit: number;
  addresses: number;
  devices: number;
}

/**
 * How long a published address stays true.
 *
 * The same number the directory reads with, so the sweeper and the reader
 * agree on when an address has expired. A device that changed network
 * publishes again, and this is the backstop for one that went away without
 * publishing.
 */
const ADDRESS_TTL_SECONDS = 60 * 60;

/**
 * How long a revoked or abandoned device row is kept.
 *
 * A device row is small, and it is the record that a device exists, so it is
 * kept for a while after the device stops talking. A revoked device is kept
 * a day, because a revocation is an event and an event is worth keeping
 * long enough to be looked at.
 */
const DEVICE_RETENTION_SECONDS = 24 * 3600;

/**
 * Bounded cleanup for the Cron Trigger. Each statement deletes at most 500
 * rows, so a backlog drains over several runs instead of one long write that
 * would count against the daily D1 write budget all at once.
 *
 * The caps are not the same for the tables, because the tables cost
 * different things:
 *
 *   * A CODE is a kilobyte of sealed invitation, and the table is the one
 *     whose growth would actually fill the storage. It gets the full 500.
 *   * A NONCE is a few dozen bytes and there is one per authenticated call,
 *     so there are many more of them and they are worth less. 2000 a run
 *     rather than 200: the Cron runs ninety-six times a day, and at 200 a
 *     run it deletes 19,200 a day, which is LESS than the write budget
 *     allows to be created (a hundred thousand rows a day, and every
 *     authenticated call now writes a nonce AND a last-seen). A sweeper
 *     that cannot keep up is not a sweeper, it is a slower leak.
 *   * An AUDIT row is the record of something that happened, and thirty days
 *     is the retention. 2000 a run keeps the table inside its window.
 *   * An ADDRESS expires on its own after an hour, and the expired ones are
 *     cleared rather than left to be read as "no such device" for ever.
 *   * A DEVICE row is kept for a day after it is revoked, and a device that
 *     has never been seen is kept for a week. Without this the table grows
 *     by one row per registration for ever, and a registration is one of the
 *     few things an anonymous caller can make.
 */
export async function sweep(env: Env, now = nowSeconds()): Promise<SweepResult> {
  const codes = await env.DB.prepare(
    `DELETE FROM signal_codes
      WHERE rowid IN (
        SELECT rowid FROM signal_codes
         WHERE expires_at < ? OR consumed_at < ?
         LIMIT 500
      )`,
  )
    .bind(now - 3600, now - 3600)
    .run();
  const nonces = await env.DB.prepare(
    `DELETE FROM auth_nonces
      WHERE rowid IN (
        SELECT rowid FROM auth_nonces WHERE expires_at < ? LIMIT 2000
      )`,
  )
    .bind(now)
    .run();
  const audit = await env.DB.prepare(
    `DELETE FROM audit_events
      WHERE rowid IN (
        SELECT rowid FROM audit_events WHERE at < ? LIMIT 2000
      )`,
  )
    .bind(now - 30 * 24 * 3600)
    .run();
  // An address that has expired is not an address. Clearing it means the
  // reader answers "no such device" rather than "no such device" by way of
  // the age check, and it means the row does not hold an address that was
  // true a week ago.
  const addresses = await env.DB.prepare(
    `UPDATE devices SET address = NULL, address_at = NULL
      WHERE address_at IS NOT NULL AND address_at < ?
      LIMIT 500`,
  )
    .bind(now - ADDRESS_TTL_SECONDS)
    .run();
  // A device nobody has heard from in a week, or one that was revoked a day
  // ago, is not a device anybody can reach.
  const devices = await env.DB.prepare(
    `DELETE FROM devices
      WHERE rowid IN (
        SELECT rowid FROM devices
         WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
            OR (last_seen_at IS NOT NULL AND last_seen_at < ?)
         LIMIT 200
      )`,
  )
    .bind(now - DEVICE_RETENTION_SECONDS, now - 7 * 24 * 3600)
    .run();
  return {
    codes: codes.meta.changes,
    nonces: nonces.meta.changes,
    audit: audit.meta.changes,
    addresses: addresses.meta.changes,
    devices: devices.meta.changes,
  };
}
