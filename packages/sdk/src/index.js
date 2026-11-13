// @sheetal/sdk: the API client every screen uses (bizApi, createApi, ApiError, setActiveTenant) and the hooks (useApiList, useApiGet, useApiMutation).
// Where it fits: docs/architecture/FOLDERS-AND-MOVE-PLAN.md sections 2 and 6.2. Filled in by task P1-FE-1.
// How it works: client.js is the old business/frontend/src/api.js (which is now a shim); hooks.js is new and no screen uses it yet.
// Then screens import it as: import { bizApi } from "@sheetal/sdk".
// Rules: browser-safe only. Never import @sheetal/platform (scripts/check-boundaries.mjs enforces it).
export * from "./client.js";
export * from "./hooks.js";
export * from "./support.js";
export * from "./branchAccess.js";
