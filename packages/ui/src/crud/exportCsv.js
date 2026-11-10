// CSV download with the formula guard.
// Where it fits: CrudPage's Export button and report tabs (Profit). Moved from LiveExpenses.jsx so every list uses one copy.
// How it works: csvCell() quotes a cell; a text cell that starts with = + - @ (or a tab / carriage return) gets a leading ' so Excel
// shows it as text and never runs it as a formula. A cell that is only a number (like -1500) is left alone so amounts stay numbers.
// Rules: the file starts with a byte-order mark so Excel reads Nepali text correctly; the name is "<name>-<YYYY-MM-DD>.csv".

import { TODAY } from "@sheetal/shared/core/format";

/** One CSV cell, guarded against formulas and quoted when needed. */
export function csvCell(v) {
  let x = v == null ? "" : String(v);
  if (/^[=+@\-\t\r]/.test(x) && Number.isNaN(Number(x))) x = `'${x}`;
  return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
}

/** The whole file text (head row, then rows), lines joined with \r\n. */
export const toCsv = (head, rows) => [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

/** Starts a browser download of the CSV. */
export function exportCsv(name, head, rows) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + toCsv(head, rows)], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}-${TODAY.slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
