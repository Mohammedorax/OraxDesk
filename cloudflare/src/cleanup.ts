import { nowSeconds } from "./encoding";
import type { Env } from "./env";

export interface SweepResult {
  codes: number;
  nonces: number;
  audit: number;
}

/**
 * Bounded cleanup for the Cron Trigger. Each statement deletes at most 500
 * rows, so a backlog drains over several runs instead of one long write that
 * would count against the daily D1 write budget all at once.
 *
 * The caps are not the same for the three tables, because the three cost
 * different things:
 *
 *   * A CODE is a kilobyte of sealed invitation, and the table is the one
 *     whose growth would actually fill the storage. It gets the full 500.
 *   * A NONCE is a few dozen bytes and there is one per authenticated call,
 *     so there are many more of them and they are worth less. 200 a run is
 *     plenty at any rate the write budget would allow: the budget is a
 *     hundred thousand rows a day, so a flood that outruns this sweeper has
 *     already spent the budget.
 *   * An AUDIT row is the record of something that happened, and thirty days
 *     is the retention. 200 a run keeps the table inside its window.
 *
 * Grace of one hour on consumed/expired codes keeps a code resolvable long
 * enough for an in-flight resolve to read its own row after the guarded
 * UPDATE.
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
        SELECT rowid FROM auth_nonces WHERE expires_at < ? LIMIT 200
      )`,
  )
    .bind(now)
    .run();
  const audit = await env.DB.prepare(
    `DELETE FROM audit_events
      WHERE rowid IN (
        SELECT rowid FROM audit_events WHERE at < ? LIMIT 200
      )`,
  )
    .bind(now - 30 * 24 * 3600)
    .run();
  return {
    codes: codes.meta.changes,
    nonces: nonces.meta.changes,
    audit: audit.meta.changes,
  };
}
