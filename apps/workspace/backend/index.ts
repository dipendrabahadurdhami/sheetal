// @sheetal/app-workspace/backend: what the rest of the repo imports from the Workspace app's server code (re-exports only; nothing runs on import).
export { workspaceRoutes, type WorkspaceRoutesOptions } from "./routes.js";
export { SECTIONS, MASK, CHECKUP_DEFAULTS } from "./workspace.service.js";
