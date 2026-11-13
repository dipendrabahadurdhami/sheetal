// Agreements screens, for the Business app: `import { AgreementsPage } from "@sheetal/app-agreements/frontend"`.
// Where it fits: apps/agreements/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// How it works: one export, the page (the list, a new draft from a lease, lead or listing, and one agreement with its live preview).
// Rules: an app never imports another app (scripts/check-boundaries.mjs); this folder imports only the kit packages and shared.
export { AgreementsPage } from "./pages/AgreementsPage.jsx";
