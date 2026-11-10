import { defineConfig } from "vitest/config";

// Server tests of the platform package. Its own file, so the run does not depend on the root vitest config
// (which is for the front-end and excludes this folder). Node environment, no globals: import { describe, it } from "vitest".
// The temporary test database setup arrives with the first task that needs it (P1-BE-1).
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"], environment: "node" },
});
