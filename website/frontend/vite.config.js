import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// @sheetal/shared → sheetal/shared/src (UI kit, store, router, translations, demo data)
const shared = fileURLToPath(new URL("../../shared/src", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
const resolve = { alias: { "@sheetal/shared": shared }, dedupe: ["react", "react-dom"] };

// The website runs on http://localhost:5173 and forwards
//   /admin/*     → admin app (port 5174)
//   /business/*  → business app (port 5175)
// so all three open from one address.
const app = (port) => ({ target: `http://localhost:${port}`, ws: true });

export default defineConfig({
  plugins: [react()],
  resolve,
  server: { port: 5173, strictPort: true, open: true, fs: { allow: [root] }, proxy: { "^/admin(/|$)": app(5174), "^/business(/|$)": app(5175) } },
  preview: { port: 4173 },
});
