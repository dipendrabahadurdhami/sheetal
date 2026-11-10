// @sheetal/platform: the server code every app uses (errors, database, tenancy, billing, payments, integrations).
// Where it fits: docs/architecture/FOLDERS-AND-MOVE-PLAN.md section 2. This file is only a placeholder, so the empty
// package installs, typechecks and tests green (task P1-OPS-1). Nothing has moved in yet.
// How it works: code arrives step by step from step 2 (P1-BE-1) and is imported by subpath, for example
// "@sheetal/platform/core/errors" (the "exports" block in package.json maps it to src/core/errors.ts).
// Rules: no code here; platform never imports apps (scripts/check-boundaries.mjs enforces it).
export {};
