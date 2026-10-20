/**
 * The audit trail.
 *
 * `audit_events` has been in the schema since the first migration and has
 * never been written to: there was no INSERT anywhere, so the table, its index
 * and its thirty day retention sweep were all dead code, and the registry had
 * no record of who registered, who minted a code, who resolved which code, or
 * when a device was revoked.
 *
 * What goes in is deliberately thin. A kind, a subject, a moment, and at most
 * a short detail. No address, no code, no invitation, no session content:
 * this table outlives the thing it describes (a code lives minutes, an audit
 * row lives a month) and must not become the longer lasting copy of a secret.
 */
import type { Env } from "./env";

/** What happened. Kept short so the schema's 32 character bound holds. */
export type AuditKind =
  | "device.registered"
  | "device.refreshed"
  | "device.revoked"
  | "address.published"
  | "signal.created"
  | "signal.resolved"
  | "signal.revoked";

/** The detail column's bound, from the schema. */
const DETAIL_MAX = 128;

/**
 * Record one event.
 *
 * A failure to write the trail does NOT fail the operation it describes: a
 * device that cannot register because the audit table is briefly unavailable
 * is a device that cannot be helped, and the trail is a record of what
 * happened rather than a precondition for it. The failure is logged at error
 * level, which is the one place a missing audit is visible.
 */
export async function audit(
  env: Env,
  kind: AuditKind,
  deviceId: string | null,
  detail?: string | null,
): Promise<void> {
  const row = detail === undefined || detail === null ? null : detail.slice(0, DETAIL_MAX);
  try {
    await env.DB.prepare(
      "INSERT INTO audit_events (at, kind, device_id, detail) VALUES (?, ?, ?, ?)",
    )
      .bind(nowSeconds(), kind, deviceId, row)
      .run();
  } catch (error) {
    console.error(
      `audit: could not record ${kind}: ${(error as Error).name}`,
    );
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
