import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// 32 bytes of a fixed test key for AES-GCM. Never a production secret.
const TEST_INVITATION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          INVITATION_KEY: TEST_INVITATION_KEY,
          // The operator endpoint is off when this is absent, which is also
          // the production default. A fixed test value lets the two branches
          // (configured, not configured) both be tested.
          OPERATOR_TOKEN: "test-operator-token-0123456789",
          // The test key is the published development key; the Worker refuses
          // it unless this is set, exactly as a local checkout has to.
          ALLOW_TEST_KEY: "1",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.spec.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
