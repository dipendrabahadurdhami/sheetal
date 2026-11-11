// @sheetal/ui: the shared screen kit (Button, Field, CrudPage, DataTable, FormBuilder, theme).
// Where it fits: docs/architecture/FOLDERS-AND-MOVE-PLAN.md sections 2 and 6.2. Filled in by task P1-FE-1.
// How it works: primitives.jsx is the old shared/src/core/ui.jsx, crud/ holds the list-page kit (the old Crud.jsx plus the new pieces),
// theme/mode.js is the old theme.js. Screens import it as: import { Button, CrudPage } from "@sheetal/ui".
// Rules: browser-safe only. Never import @sheetal/platform (scripts/check-boundaries.mjs enforces it).
// Two Drawers exist: `Drawer` is the plain one every screen uses today; `SideDrawer` is the new one with sizes, discard-changes and a focus trap.
export * from "./primitives.jsx";
export * from "./theme/mode.js";
export { Stars, starsOn, starsLabel } from "./Stars.jsx";
export { ViewDrawer, DeleteConfirm, restoreAt, useUndo, DataTable, FormBuilder, CrudPage, exportCsv, csvCell, toCsv, lastMonths, labelOf, optionsOf } from "./crud/index.js";
export { Drawer as SideDrawer } from "./crud/Drawer.jsx";
