// @sheetal/app-reviews: the Reviews app (manifest, backend, frontend).
// Where it fits: docs/architecture/FOLDERS-AND-MOVE-PLAN.md section 2. Placeholder only (task P1-OPS-1).
// How it works: at step 8 (P1-BE-6) this folder gets app.manifest.ts, backend/ and frontend/, and the package's
// "exports" become "./backend", "./frontend" and "./manifest". This src/ placeholder is deleted then.
// Rules: an app imports platform and packages, never another app (scripts/check-boundaries.mjs enforces it).
export {};
