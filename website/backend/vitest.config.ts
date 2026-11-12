import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A throwaway PostgreSQL with the shared schema (see platform/test/setup-db.ts).
    globalSetup: ["../../platform/test/setup-db.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
