// Expenses screens, for the Business app: `import { ExpensesPage } from "@sheetal/app-expenses/frontend"`.
// Where it fits: apps/expenses/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// How it works: one export, the page. The resource descriptions and the Profit tab are inside the folder.
// Rules: an app never imports another app (scripts/check-boundaries.mjs); this folder imports only the kit packages and shared.
export { ExpensesPage } from "./pages/ExpensesPage.jsx";
