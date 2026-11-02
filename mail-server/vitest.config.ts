import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A throwaway PostgreSQL with the shared schema (see backend-core/test/setup-db.ts).
    globalSetup: ["../backend-core/test/setup-db.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
