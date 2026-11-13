// People screens, for the Business app: `import { PeoplePage } from "@sheetal/app-people/frontend"`.
// Where it fits: apps/people/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// How it works: one export, the page (Today, Board, Leave requests, Month).
// Rules: an app never imports another app (scripts/check-boundaries.mjs); this folder imports only the kit packages and shared.
export { PeoplePage } from "./pages/PeoplePage.jsx";
