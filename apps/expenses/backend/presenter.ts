// How an expense and a recurring expense look to the screen.
// Where it fits: the controllers answer with these; moved from routes.ts (P1-BE-5). The JSON is the one the page already reads.
// How it works: money is whole rupees under `amount` (read from paisa), dates are YYYY-MM-DD, empty text is "". One field is new and harmless: `version`
// (a whole number); the new page sends it back when saving so a stale save is refused (409).
// Rules: never put amountPaisa (a BigInt) in the answer: JSON cannot carry it.

import type { ExpenseRow, RecurringExpenseRow } from "./types.js";
import { expenseNo } from "./categories.js";
import { rupeesOf } from "./money.js";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export const present = (e: ExpenseRow, names: Map<string, string>) => ({
  id: e.id, no: expenseNo(e.seq), status: e.status, date: day(e.spentOn)!, category: e.category, amount: rupeesOf(e), vendor: e.vendor ?? "", note: e.note ?? "", method: e.method,
  branchId: e.branchId, branch: names.get(e.branchId) ?? "", hasReceipt: !!e.receiptFile, recurringId: e.recurringId, forMonth: e.forMonth, version: e.version,
});

export const presentRecurring = (r: RecurringExpenseRow, names: Map<string, string>) => ({
  id: r.id, status: r.status, category: r.category, amount: rupeesOf(r), vendor: r.vendor ?? "", note: r.note ?? "", method: r.method, dayOfMonth: r.dayOfMonth, startMonth: r.startMonth,
  branchId: r.branchId, branch: names.get(r.branchId) ?? "", version: r.version,
});
