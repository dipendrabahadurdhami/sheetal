// @sheetal/config: constants both the screens and the servers read (generated permissions, colour maths, kernel text keys).
// Where it fits: docs/architecture/FOLDERS-AND-MOVE-PLAN.md sections 2 and 6.2. Placeholder only (task P1-OPS-1).
// How it works: the generated permissions arrive at step 3 (P1-BE-2) and the colour maths at step 9 (P1-FE-1).
// Subpaths map to files: "@sheetal/config/color" is src/color.js. The plan names the permissions file
// permissions.generated.js, so BE-2 adds the "./permissions" mapping to package.json when it creates that file.
// Rules: browser-safe, no DOM, no @sheetal/platform (scripts/check-boundaries.mjs enforces it).
export {};
