// DeleteConfirm: ask first, delete, then offer Undo.
// Where it fits: most list pages in both panels. Moved here from shared/src/components/Crud.jsx (task P1-FE-1); that file is now a shim.
// How it works: Confirm opens when `item` is set; on confirm onDelete(item) runs and an undo toast calls onRestore(copy) if given.
// Rules: keep the exported names and props as they were.

import { Confirm } from "../primitives.jsx";
import { useUndo } from "./useUndo.jsx";

// Delete with Confirm, then an undo toast. `item` opens it; onDelete(item) removes, onRestore(copy) puts it back.
export function DeleteConfirm({ item, name, what = "item", onClose, onDelete, onRestore, children }) {
  const undo = useUndo();
  const What = what[0].toUpperCase() + what.slice(1);
  return (
    <Confirm open={!!item} onClose={onClose} danger confirmLabel="Delete"
      title={item ? (name ? `Delete “${name}”?` : `Delete this ${what}?`) : ""}
      onConfirm={() => { const copy = structuredClone(item); onDelete(item); undo(`${What} deleted`, onRestore ? () => onRestore(copy) : null); }}>
      {children || "You can undo this for a few seconds after deleting."}
    </Confirm>
  );
}

// Put a deleted record back where it was (by index), or at the top.
export const restoreAt = (list, item, index) => { list.splice(index >= 0 && index <= list.length ? index : 0, 0, item); };
