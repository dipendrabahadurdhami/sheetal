// The list-page kit: CrudPage, DataTable, FormBuilder, the extended Drawer, ViewDrawer, DeleteConfirm, undo toast, CSV export, form rules.
// Where it fits: "@sheetal/ui/crud". The old shared/src/components/Crud.jsx re-exports the first four names from here.
// Rules: ViewDrawer, DeleteConfirm, useUndo, restoreAt keep the API they had in Crud.jsx.
export { ViewDrawer } from "./ViewDrawer.jsx";
export { DeleteConfirm, restoreAt } from "./DeleteConfirm.jsx";
export { useUndo } from "./useUndo.jsx";
export { Drawer } from "./Drawer.jsx";
export { DataTable, useWidth } from "./DataTable.jsx";
export { FormBuilder, labelOf, optionsOf } from "./FormBuilder.jsx";
export { CrudPage, lastMonths } from "./CrudPage.jsx";
export { exportCsv, csvCell, toCsv } from "./exportCsv.js";
export { isEmpty, evalRule, fieldState, visibleFields, digits, defaultValues, validateFields, buildBody, firstInvalidKey } from "./formRules.js";
export { versionQuery, versionBody, isConflict, failureKind, reactToFailure, submitRecord, removeRecord, runRowAction } from "./saveFlow.js";
