// Reviews screens, for the Business app: `import { ReviewsPage } from "@sheetal/app-reviews/frontend"`.
// Where it fits: apps/reviews/package.json maps "./frontend" here; business/frontend/vite.config.js points Vite at it.
// How it works: one export, the page. The resource description, the review card and the reply box are inside the folder.
// Rules: an app never imports another app (scripts/check-boundaries.mjs); this folder imports only the kit packages and shared.
export { ReviewsPage } from "./pages/ReviewsPage.jsx";
