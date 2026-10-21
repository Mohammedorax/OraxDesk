# Orax Remote — registry Worker (Cloudflare)

Device registry and signal-code service for Orax Remote. This directory is the
**Worker + D1** side of [the implementation plan](../docs/CLOUDFLARE_IMPLEMENTATION_PLAN.md).
The remote-desktop transport stays where it is: `crates/boundary-session` over
iroh/QUIC. Nothing here ever carries screen, input or clipboard data.

## Phase status

| Phase | State |
|---|---|
| P2 — schema and migrations | implemented, tested locally |
| P3 — API and authentication | implemented, 62/62 Worker tests + 13/13 schema tests, `tsc` clean |
| P4 — security hardening and limits | done: per-IP resolve limit, `/healthz` config status, per-device cap, key rotation (`key_id`, migration 0002), 15-minute cleanup Cron |
| P5 — Rust client | verified: `cargo test -p orax-registry` 8/8, `clippy -D warnings` clean, `cargo check
 -p deskvncviewer` clean; six Tauri commands wired (`commands/registry.rs`) |
| P6 — key separation and the device directory | implemented: the registry key is its own key (never the identity key), and a device publishes its address so a helper can find it by id. 62/62 Worker tests + 13/13 schema tests, `tsc` clean |
| Deployed | `https://orax-registry.oraxhome.workers.dev` on D1 `oraxdesk-db`; 28/28 live checks pass, test rows removed |

### Live verification

```sh
node scripts/smoke.mjs https://orax-registry.oraxhome.workers.dev
```

Registers a throwaway device, creates and resolves codes, checks single use and
revocation, then revokes the device so the database is left clean. `INVITATION_KEY`
must be set (`wrangler secret put INVITATION_KEY`, 32 random bytes, base64);
without it every `/v1/signals` call fails closed with 503.

It also checks the two things that were added last, against the live
deployment rather than only against a unit test, because the failure mode of
both is "the deployed Worker is not the one that was tested":

- **the separation of the registry key from the identity** — a call signed with
  the registry key is accepted, the same call signed with the identity is
  refused once a registry key exists, and a registry key that *is* the identity
  is refused at registration.
- **the device directory** — an address is published and read back, an address
  carrying a secret-shaped field is refused, and an address for another device
  is refused.

The run leaves its devices revoked but present, because a revoked device is
still a row. To leave the database as it was found:

```sh
npx wrangler d1 execute oraxdesk-db --remote --command \
  "DELETE FROM audit_events; DELETE FROM devices WHERE label LIKE 'smoke test%';"
```

### P3 API surface

`POST /v1/devices` (signed by the new key), `GET /v1/devices/{id}`,
`POST /v1/devices/{id}/revoke` (signed by that device), `POST /v1/signals`
(signed), `POST /v1/signals/resolve` (the code is the capability),
`POST /v1/signals/revoke` (revoke token), `GET /healthz`.

The device directory adds two more: `POST /v1/devices/{id}/address` (signed by
that device) and `GET /v1/devices/{id}/address` (public, like iroh's own public
directory).

### The device directory

A machine publishes where it is, so a helper can reach it by its id without
reading sixty-four characters of hex down the phone.

The address is **address data, not session data**. iroh's QUIC handshake
authenticates the peer by its key, so an address is a place to knock and never
a way in. Nothing in the directory decides who may connect: that decision is
the machine's own, in its access file, made when the connection arrives. A
directory that could say no would be a directory with authority over machines.

The nine digit number is a lookup key and **not a secret**: it resolves to the
id, and the id resolves to the address. That is the price of reading a number
down the phone, and it is why the by-number route is rate limited.

A published address is taken apart and put back together from what is
understood: the device id, and a list of transport addresses that are either a
socket address or a relay URL. Any other field is refused, because a registry
that accepts a secret-shaped field in an address ends up holding one. An
address older than an hour reads as no address at all, so a helper that finds
a stale one fails to connect rather than connecting to the wrong place.

The client is `crates/orax-registry/src/directory.rs`, and the session wiring
is `HostOptions::directory` in `crates/boundary-session`. A deployment points
it at its own registry with `ORAX_REGISTRY_URL`; a deployment that sets
nothing keeps publishing to n0 exactly as before.

Authentication is a per-request ed25519 signature over
`orax-device-auth-v2\nORIGIN\nMETHOD\nPATH\nsha256(body)\ntimestamp\nnonce`, with a
±120 s window and single-use nonces for registration and revocation. Creating a
signal treats the nonce as an idempotency key instead, so a retry after a lost
response returns the same code.

The **origin** is part of what is signed, so a signature captured at one
registry cannot be replayed at another. A v1 signature (the same string without
the origin) is still accepted, because a v2 Worker cannot read a v1 client's
signature and the rollout would otherwise lock every registered device out.
Every v1 acceptance is logged, so the window can be closed as soon as the old
clients have drained.

### Two keys, not one

A device has an **identity key** (its iroh key, which every paired machine
trusts) and a **registry key** (which signs nothing but this registry's API
calls). They were the same key once, and that was the largest blast radius in
the system: leaking the registry key was leaking the device's identity, and
every machine paired with it.

The registration is signed with the identity key and offers a `registry_key` in
the same body, because a Worker cannot verify a signature against a key it has
never seen. Every later call is signed with the registry key, and the Worker
verifies against it when the device has one.

The rollout runs in both directions without either side being able to break
the other. A Worker that predates the field verifies against the identity key
and answers `400`, and the client retries without the field. A device that
predates the field sends no `registry_key`, and the Worker verifies against
the identity key. A registry key that is byte-for-byte the device's own
identity key is refused, because that is the state this change exists to end.

On the client the key lives in the system keychain
(`com.deskvncviewer.registry`), and falls back to a file with `0600` permissions
where there is no keychain.

### What the registry records

Every registration, code, resolution, withdrawal and revocation writes one row
to `audit_events`: a kind, the device it concerns, the moment, and at most a
short detail. No address, no code, no invitation, no session content — an audit
row outlives the thing it describes, so it must not become the longer lasting
copy of a secret.

`devices.last_seen_at` is written on every authenticated call, so it is a
record of the device being here rather than a heartbeat: a device that never
calls the registry is never written about, and there is no timer to keep the
table busy.

Notable findings recorded while building it:

- **EndpointId is lower-case hex, not base32:** `iroh-base/src/key.rs` has
  `Display` -> `HEXLOWER` (64 characters); `FromStr` additionally accepts
  z-base-32. Migration, plan and audit were corrected.
- Ed25519 verification and AES-GCM both work in workerd's WebCrypto, so the
  Worker has no third-party crypto dependency.
- workerd's SQLite rejects a twelve-group GLOB pattern (`pattern too complex`);
  the schema uses one negated class instead.

### P2 results (2026-10-17)

- `npm test` — 13/13 offline schema tests pass (`node:sqlite`).
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

- A migration is never destructive: no `DROP`, no `TRUNCATE`, no `DELETE FROM`.
  The FIRST migration is also idempotent (`IF NOT EXISTS`), so applying it
  twice is a no-op. The later ones ADD COLUMNS, and SQLite has no
  `ADD COLUMN IF NOT EXISTS`, so they are not idempotent and do not need to
  be: `wrangler d1 migrations apply` tracks which migrations have run and
  runs each exactly once.
- Positional parameters are plain `?`, never `?1`, so the same SQL runs under
  `wrangler` (D1), `node:sqlite`, and the P3 Worker.
- All limits are constants in one place (`src/constants.ts`): body 16 KiB,
  invitation ciphertext ≤ 4 KiB, code TTL ≤ 600 s, label ≤ 64 bytes.
