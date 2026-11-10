// ViewDrawer: a read-only side panel for one record.
// Where it fits: most list pages in both panels. Moved here from shared/src/components/Crud.jsx (task P1-FE-1); that file is now a shim.
// How it works: facts are label/value pairs (empty ones are left out); Edit, Delete and extra actions show only when given.
// Rules: keep the exported names and props as they were.

import React from "react";
import { Button, Drawer } from "../primitives.jsx";

// Read-only view of one record. facts: [[label, value], ...]; empty values are left out.
export function ViewDrawer({ open, onClose, title, sub, facts = [], children, onEdit, onDelete, actions, deleteLabel = "Delete" }) {
  const shown = facts.filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false);
  return (
    <Drawer open={open} onClose={onClose} title={title} sub={sub}
      footer={(onEdit || onDelete || actions) && <>
        {onDelete && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" onClick={onDelete}>{deleteLabel}</Button>}
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
