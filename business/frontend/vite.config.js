import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// @sheetal/shared → sheetal/shared/src (UI kit, store, router, translations, demo data)
const shared = fileURLToPath(new URL("../../shared/src", import.meta.url));
const root = fileURLToPath(new URL("../..", import.meta.url));
// The Expenses screens live in apps/expenses/frontend (P1-FE-2); this makes sure Vite finds them even before npm has linked the workspace.
const expensesFrontend = fileURLToPath(new URL("../../apps/expenses/frontend/index.js", import.meta.url));
// The Reviews screens live in apps/reviews/frontend (P1-FE-3), found the same way.
const reviewsFrontend = fileURLToPath(new URL("../../apps/reviews/frontend/index.js", import.meta.url));
// The People screens live in apps/people/frontend (Phase 2), found the same way.
const peopleFrontend = fileURLToPath(new URL("../../apps/people/frontend/index.js", import.meta.url));
const resolve = { alias: { "@sheetal/shared": shared, "@sheetal/app-expenses/frontend": expensesFrontend, "@sheetal/app-reviews/frontend": reviewsFrontend, "@sheetal/app-people/frontend": peopleFrontend }, dedupe: ["react", "react-dom"] };

// Served under /business/. Open it through the website at http://localhost:5173/business/ (not this port directly),
// so images, sign-in and demo data are shared with the website.
export default defineConfig({
  base: "/business/",
  plugins: [react()],
  resolve,
  server: { port: 5175, strictPort: true, fs: { allow: [root] }, hmr: { clientPort: 5173 } },
});
