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
 * Grace of one hour on consumed/expired codes keeps a code resolvable long
 * enough for an in-flight resolve to read its own row after the guarded UPDATE.
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
        SELECT rowid FROM auth_nonces WHERE expires_at < ? LIMIT 500
      )`,
  )
    .bind(now)
    .run();
  const audit = await env.DB.prepare(
    `DELETE FROM audit_events
      WHERE rowid IN (
        SELECT rowid FROM audit_events WHERE at < ? LIMIT 500
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
