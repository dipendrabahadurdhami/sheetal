import { defineConfig } from "vitest/config";

// Server tests of this app (its backend/ folder). Its own file, so the run does not depend on the root vitest config.
// The app's screen tests (frontend/) run in the root front-end run instead.
export default defineConfig({
  test: { include: ["backend/**/*.test.ts"], environment: "node" },
});
