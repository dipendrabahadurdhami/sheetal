import React from "react";
import { Button, Confirm, Drawer, useToast } from "../core/ui";

// One pattern on every list page: list → view drawer → edit → delete with Confirm and an undo toast.

// toast with an Undo button; stays up a little longer than a normal toast
export function useUndo() {
  const toast = useToast();
  return (msg, undo) => toast(
    <span className="pf-undo"><span>{msg}</span>{undo && <button type="button" onClick={undo}>Undo</button>}</span>, undo ? 6000 : undefined);
}

// Read-only view of one record. facts: [[label, value], ...]; empty values are left out.
export function ViewDrawer({ open, onClose, title, sub, facts = [], children, onEdit, onDelete, actions }) {
  const shown = facts.filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false);
  return (
    <Drawer open={open} onClose={onClose} title={title} sub={sub}
      footer={(onEdit || onDelete || actions) && <>
        {onDelete && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" onClick={onDelete}>Delete</Button>}
        {actions}
        {onEdit && <Button icon="pencil" onClick={onEdit}>Edit</Button>}
      </>}>
      <div className="pf-stack">
        {shown.length > 0 && <dl className="pf-kv">{shown.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>}
        {children}
      </div>
    </Drawer>
  );
}

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
