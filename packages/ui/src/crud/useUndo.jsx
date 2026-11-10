// Undo toast: a message with an Undo button.
// Where it fits: most list pages in both panels. Moved here from shared/src/components/Crud.jsx (task P1-FE-1); that file is now a shim.
// How it works: useUndo() returns toast(message, undoFn); the toast stays up 6 seconds when there is something to undo.
// Rules: keep the exported names and props as they were.

import React from "react";
import { useToast } from "../primitives.jsx";

// toast with an Undo button; stays up a little longer than a normal toast
export function useUndo() {
  const toast = useToast();
  return (msg, undo) => toast(
    <span className="pf-undo"><span>{msg}</span>{undo && <button type="button" onClick={undo}>Undo</button>}</span>, undo ? 6000 : undefined);
}
