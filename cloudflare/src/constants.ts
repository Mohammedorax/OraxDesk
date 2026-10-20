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
 * It only has to outlive the window in which a captured request could still
 * be replayed, and that window is the skew: a request whose timestamp is
 * more than [`AUTH_MAX_SKEW_SECONDS`] old is refused on the timestamp
 * before the nonce is ever consulted. Six hundred seconds was three times
 * that, which held three times as many rows for no extra safety, and the
 * table is written once per authenticated call, so every row is a row of the
 * daily write budget spent on remembering something that could not be used
 * again.
 */
export const NONCE_TTL_SECONDS = 180;
export const MAX_LABEL_CHARS = 64;
export const MAX_CLIENT_VERSION_CHARS = 32;
export const MAX_CODES_PER_HOUR = 20;
export const CODE_DIGITS = 12;
export const REVOKE_TOKEN_BYTES = 32;
export const AES_KEY_BYTES = 32;
