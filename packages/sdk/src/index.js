// @sheetal/sdk: the API client every screen uses (bizApi, adminApi, ApiError, setActiveTenant, hooks).
// Where it fits: docs/architecture/FOLDERS-AND-MOVE-PLAN.md sections 2 and 6.2. Placeholder only (task P1-OPS-1).
// How it works: business/frontend/src/api.js moves in at step 9 (P1-FE-1), leaving a shim at the old path.
// Then screens import it as: import { bizApi } from "@sheetal/sdk".
// Rules: browser-safe only. Never import @sheetal/platform (scripts/check-boundaries.mjs enforces it).
export {};
