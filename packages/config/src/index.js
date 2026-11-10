// @sheetal/config: constants both the screens and the servers read (generated permissions, colour maths, kernel text keys).
// Where it fits: docs/architecture/FOLDERS-AND-MOVE-PLAN.md sections 2 and 6.2.
// How it works: the generated files are permissions.generated.js ("@sheetal/config/permissions", P1-BE-2) and apps.generated.js
// ("@sheetal/config/apps"); the colour maths arrives at step 9 (P1-FE-1). Other subpaths map to files: "@sheetal/config/color" is src/color.js.
// Rules: browser-safe, no DOM, no @sheetal/platform (scripts/check-boundaries.mjs enforces it). Never edit a *.generated.js file by hand.
export {};
