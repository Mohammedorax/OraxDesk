# Orax Remote — registry Worker (Cloudflare)

Device registry and signal-code service for Orax Remote. This directory is the
**Worker + D1** side of [the implementation plan](../docs/CLOUDFLARE_IMPLEMENTATION_PLAN.md).
The remote-desktop transport stays where it is: `crates/boundary-session` over
iroh/QUIC. Nothing here ever carries screen, input or clipboard data.

## Phase status

| Phase | State |
|---|---|
| P2 — schema and migrations | implemented, tested locally |
| P3 — API and authentication | implemented, 28/28 Worker tests + 12/12 schema tests, `tsc` clean |
| P4 — security hardening and limits | done: per-IP resolve limit, `/healthz` config status, per-device cap, key rotation (`key_id`, migration 0002), 15-minute cleanup Cron |
| P5 — Rust client | verified: `cargo test -p orax-registry` 5/5, `clippy -D warnings` clean, `cargo check -p deskvncviewer` clean; six Tauri commands wired (`commands/registry.rs`) |
| Deployed | `https://orax-registry.oraxhome.workers.dev` on D1 `oraxdesk-db`; 14/14 live checks pass, test rows removed |

### Live verification

```sh
node scripts/smoke.mjs https://orax-registry.oraxhome.workers.dev
```

Registers a throwaway device, creates and resolves codes, checks single use and
revocation, then revokes the device so the database is left clean. `INVITATION_KEY`
must be set (`wrangler secret put INVITATION_KEY`, 32 random bytes, base64);
without it every `/v1/signals` call fails closed with 503.

### P3 API surface

`POST /v1/devices` (signed by the new key), `GET /v1/devices/{id}`,
`POST /v1/devices/{id}/revoke` (signed by that device), `POST /v1/signals`
(signed), `POST /v1/signals/resolve` (the code is the capability),
`POST /v1/signals/revoke` (revoke token), `GET /healthz`.

Authentication is a per-request ed25519 signature over
`orax-device-auth-v1\nMETHOD\nPATH\nsha256(body)\ntimestamp\nnonce`, with a
±120 s window and single-use nonces for registration and revocation. Creating a
signal treats the nonce as an idempotency key instead, so a retry after a lost
response returns the same code.

Notable findings recorded while building it:

- **EndpointId is lower-case hex, not base32:** `iroh-base/src/key.rs` has
  `Display` -> `HEXLOWER` (64 characters); `FromStr` additionally accepts
  z-base-32. Migration, plan and audit were corrected.
- Ed25519 verification and AES-GCM both work in workerd's WebCrypto, so the
  Worker has no third-party crypto dependency.
- workerd's SQLite rejects a twelve-group GLOB pattern (`pattern too complex`);
  the schema uses one negated class instead.

### P2 results (2026-10-17)

- `npm test` — 12/12 offline schema tests pass (`node:sqlite`).
- `wrangler d1 migrations apply … --local` — applied on a fresh database (14
  statements), and a second run reports `No migrations to apply!`.
- Local D1 checks: valid device + code insert succeed; first consume changes 1
  row and the second changes 0 (`consumed=1`, `unconsumed=0`); a code with a
  letter is rejected by CHECK; a second device with the same public key is
  rejected by UNIQUE.
- **Platform finding:** workerd's SQLite rejects the twelve-`[0-9]`-group GLOB
  with `LIKE or GLOB pattern too complex`, while `node:sqlite` accepts it. The
  migration now uses one negated class (`*[^0-9]*`), which both engines accept.
  Both engines are kept in the loop for exactly this kind of divergence.

## Local development

No Cloudflare account is needed for anything below.

```sh
npm install                     # wrangler, typescript, worker types
npm test                        # offline schema tests (node:sqlite, no deps needed)
npx wrangler d1 migrations apply orax-registry --local
npx wrangler dev                # serves /healthz and 501 everywhere else
```

`npm test` is dependency-free on purpose: it applies
`migrations/0001_init.sql` to a real SQLite engine through `node:sqlite`, so the
schema can be verified before any toolchain install.

## What the schema guarantees

- `devices` is keyed by the ed25519 `EndpointId`; no client-chosen identifier is
  stored, so a row cannot be claimed by knowing a string.
- `signal_codes.ciphertext` is an AES-GCM sealed invitation. The address and the
  32-byte session secret never reach D1 in the clear.
- A code is single-use: `consumed_at` is written by one guarded `UPDATE`, and a
  lost response is retried idempotently through `UNIQUE (host_id, auth_nonce)`.
- Revocation tokens are stored as SHA-256 only.
- No column can hold media: a test walks every table and fails on names such as
  `frame`, `pixel`, `screen`, `input`, `clipboard`, `audio`.

## Conventions

- Every statement is idempotent (`IF NOT EXISTS`, `INSERT OR IGNORE`); a
  migration is never destructive.
- Positional parameters are plain `?`, never `?1`, so the same SQL runs under
  `wrangler` (D1), `node:sqlite`, and the P3 Worker.
- All limits are constants in one place (`src/limits.ts` in P3): body 16 KiB,
  invitation ciphertext ≤ 4 KiB, code TTL ≤ 600 s, label ≤ 64 bytes.
