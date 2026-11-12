import { defineConfig } from "vitest/config";

// Server tests of the platform package. Its own file, so the run does not depend on the root vitest config
// (which is for the front-end and excludes this folder). Node environment, no globals: import { describe, it } from "vitest".
// Database tests share the throwaway PostgreSQL that platform/test/setup-db.ts starts once per run (P1-BE-1); the platform
// does not import backend-core code, it only borrows that setup file. Files run one after another because they share that database.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/setup-db.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
