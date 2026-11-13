// @sheetal/app-people/backend: what the rest of the repo imports from the People app's server code.
// Where it fits: business/backend/src/app.ts (routes) and the old route file (shim).
// How it works: re-exports only. Nothing here runs on import.
// Rules: an app exports its routes; the repositories and the service stay inside the app (tests import them by path).

export { peopleRoutes, type PeopleRoutesOptions } from "./routes.js";
