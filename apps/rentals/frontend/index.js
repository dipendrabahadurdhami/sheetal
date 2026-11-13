// Rentals screens, for the Business app: `import { RentalsPage } from "@sheetal/app-rentals/frontend"`.
// Where it fits: apps/rentals/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// How it works: one export, the page (overview, owners and units, leases, bills and payments, repairs, owner statements).
// Rules: an app never imports another app (scripts/check-boundaries.mjs); this folder imports only the kit packages and shared.
export { RentalsPage } from "./pages/RentalsPage.jsx";
