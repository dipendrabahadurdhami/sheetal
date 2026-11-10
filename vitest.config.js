import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The root run covers the front-end code (shared, screens, packages/*). Server code has its own run in its own package
// (npm run test -w ...), so it is excluded here: backend-core, the three APIs, the mail server, platform, and the
// backend/ folder of every app under apps/.
export default defineConfig({
  resolve: { alias: { "@sheetal/shared": fileURLToPath(new URL("./shared/src", import.meta.url)) } },
  test: {
    include: ["**/*.test.{js,jsx,ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "backend-core/**", "website/backend/**", "business/backend/**", "admin/backend/**", "mail-server/**", "platform/**", "apps/**/backend/**"],
    globals: true,
  },
});
