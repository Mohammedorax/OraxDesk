import type { D1Migration } from "@cloudflare/vitest-plugin";

// `cloudflare:test`'s `env` is typed as `Cloudflare.Env` (workers-types declares
// that interface empty for projects to fill in). This is the test-side view of
// the same bindings the Worker sees, plus the migration fixture.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      API_VERSION: string;
      INVITATION_KEY: string;
      ALLOW_TEST_KEY?: string;
      OPERATOR_TOKEN?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
