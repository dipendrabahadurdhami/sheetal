// Moved: the Reviews routes now live in apps/reviews/backend (P1-BE-6). This one-line shim keeps the old import path working.
// Where it fits: nothing in the business API imports this file any more (app.ts imports @sheetal/app-reviews/backend); checkups.ts stays in this folder.
// How it works: re-exports reviewRoutes and its options type from the app.
// Rules: do not add code here; delete the file when nobody imports it.

export { reviewRoutes, type ReviewRoutesOptions } from "@sheetal/app-reviews/backend";
