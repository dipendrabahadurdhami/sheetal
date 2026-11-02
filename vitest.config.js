import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@sheetal/shared": fileURLToPath(new URL("./shared/src", import.meta.url)) } },
  test: { include: ["**/*.test.{js,jsx,ts,tsx}"], exclude: ["**/node_modules/**", "**/dist/**", "backend-core/**", "website/backend/**", "business/backend/**", "admin/backend/**", "mail-server/**"], globals: true },
});
