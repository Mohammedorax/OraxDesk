export interface Env {
  DB: D1Database;
  INVITATION_KEY: string;
  /** Rotation window: rows sealed under the previous key stay readable. */
  INVITATION_KEY_ID?: string;
  INVITATION_KEY_PREVIOUS?: string;
  INVITATION_KEY_ID_PREVIOUS?: string;
  API_VERSION?: string;
}
