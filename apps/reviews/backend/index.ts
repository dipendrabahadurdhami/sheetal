// @sheetal/app-reviews/backend: what the rest of the repo imports from the Reviews app's server code.
// Where it fits: business/backend/src/app.ts (routes).
// How it works: re-exports only. Nothing here runs on import.
// Rules: an app exports its routes; the repository and service stay inside the app.

export { reviewRoutes, type ReviewRoutesOptions } from "./routes.js";
