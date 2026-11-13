// @sheetal/app-agreements/backend: what the rest of the repo imports from the Agreements app's server code.
// Where it fits: business/backend/src/app.ts (routes) and the old route file (shim).
// Rules: re-exports only. The repository and the service stay inside the app (tests import them by path).

export { agreementRoutes, type AgreementRoutesOptions } from "./routes.js";
