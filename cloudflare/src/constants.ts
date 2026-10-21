export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_INVITATION_CHARS = 8 * 1024;
export const MAX_CIPHERTEXT_BYTES = 4096;
export const CODE_TTL_MIN = 30;
export const CODE_TTL_MAX = 600;
export const CODE_TTL_DEFAULT = 600;
export const INVITATION_MAX_FUTURE = 660;
export const AUTH_MAX_SKEW_SECONDS = 120;
/**
 * How long a used nonce is remembered.
 *
 * It has to outlive the window in which a captured request could still be
 * replayed, and that window is TWICE the skew, not once: a request whose
 * timestamp is in the future by the full skew is still accepted when it
 * arrives, so the last moment at which it could be replayed is the skew
 * AFTER its timestamp, and the last moment at which it could have first been
 * seen is the skew BEFORE it. The window a nonce has to cover is therefore
 * from `timestamp - skew` to `timestamp + skew`.
 *
 * Three hundred seconds covers that with a margin, and the margin is the
 * point: a nonce that is swept while its request is still replayable is a
 * request that can be replayed.
 */
export const NONCE_TTL_SECONDS = 300;
/**
 * When the legacy (v1) signature stops being accepted.
 *
 * The v1 canonical string has no origin in it, so a signature captured at one
 * registry verifies at another. The v2 form binds the origin, and the v2
 * form is what every current client sends. The v1 form is accepted only
 * while this is in the future, and it is a NUMBER rather than a flag: a flag
 * is a window with no end, and the whole point of the window is that it can
 * be closed.
 *
 * Set it to a past timestamp to close the window at once. The default is
 * generous, because a device that has not been updated in six months is a
 * device nobody has, and the log line on every acceptance is how an
 * operator knows when it is safe to close it early.
 */
export const LEGACY_AUTH_ACCEPT_UNTIL = Date.now() / 1000 + 180 * 24 * 3600;
export const MAX_LABEL_CHARS = 64;
export const MAX_CLIENT_VERSION_CHARS = 32;
export const MAX_CODES_PER_HOUR = 20;
export const CODE_DIGITS = 12;
export const REVOKE_TOKEN_BYTES = 32;
export const AES_KEY_BYTES = 32;
