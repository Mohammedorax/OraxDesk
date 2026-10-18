import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-plugin";

const bindings = env as unknown as {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

// Each test file gets its own isolated D1 storage, so the migration is applied
// per file and never shared between tests.
await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
