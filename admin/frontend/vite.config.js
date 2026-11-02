import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// @sheetal/shared → sheetal/shared/src (UI kit, store, router, translations, demo data)
const shared = fileURLToPath(new URL("../../shared/src", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
const resolve = { alias: { "@sheetal/shared": shared }, dedupe: ["react", "react-dom"] };

// Served under /admin/. Open it through the website at http://localhost:5173/admin/ (not this port directly),
// so images, sign-in and demo data are shared with the website.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  resolve,
  server: { port: 5174, strictPort: true, fs: { allow: [root] }, hmr: { clientPort: 5173 } },
});
