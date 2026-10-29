export interface Env {
  DB: D1Database;
  INVITATION_KEY: string;
  /** Rotation window: rows sealed under the previous key stay readable. */
  INVITATION_KEY_ID?: string;
  INVITATION_KEY_PREVIOUS?: string;
  INVITATION_KEY_ID_PREVIOUS?: string;
  API_VERSION?: string;
  /**
   * Set to "1" ONLY in a local development environment. Without it, a
   * deployment whose INVITATION_KEY is the published development key refuses
   * to mint or resolve codes, because anyone who has read this repository can
   * forge invitations sealed with it.
   */
  ALLOW_TEST_KEY?: string;
  /**
   * Optional operator key for the admin endpoint that revokes a device from
   * the server side. Absent means the endpoint does not exist at all, which is
   * the right default: a deployment that has not chosen an operator is one
   * nobody should be able to administer remotely.
   */
  OPERATOR_TOKEN?: string;
}
