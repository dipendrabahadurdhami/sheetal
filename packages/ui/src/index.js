// @sheetal/ui: the shared screen kit (Button, Field, CrudPage, DataTable, FormBuilder, theme).
// Where it fits: docs/architecture/FOLDERS-AND-MOVE-PLAN.md sections 2 and 6.2. Placeholder only (task P1-OPS-1).
// How it works: code moves in at step 9 (P1-FE-1) from shared/src/core/ui.jsx and shared/src/components/Crud.jsx,
// leaving shims at the old paths. Then screens import it as: import { Button, CrudPage } from "@sheetal/ui".
// Rules: browser-safe only. Never import @sheetal/platform (scripts/check-boundaries.mjs enforces it).
export {};
