// The events Expenses publishes: names and payloads, as listed in app.manifest.ts (events.publishes).
// Where it fits: the services publish them inside the write's transaction (BaseService.wrote / action); other apps may subscribe through their own manifest.
// How it works: one function per event builds its small JSON payload (ids, strings and PAISA amounts; never rupees, never secrets). The names are constants so
// a typo cannot publish an event the manifest does not list.
// Rules: payload fields are exactly the manifest's; change a payload only by adding a version (v: 2) in the manifest first.

import type { ExpenseRow } from "./types.js";
import { paisaOfRow } from "./money.js";

export const EXPENSE_EVENTS = {
  confirmed: "expenses.expense.confirmed",
  updated: "expenses.expense.updated",
  deleted: "expenses.expense.deleted",
  skipped: "expenses.expense.skipped",
  draftCreated: "expenses.recurring.draft_created",
} as const;

const day = (d: Date) => d.toISOString().slice(0, 10);

/** An expense was added, or a draft was confirmed. */
export const confirmedPayload = (e: ExpenseRow) => ({ expenseId: e.id, branchId: e.branchId, category: e.category, amountPaisa: paisaOfRow(e), spentOn: day(e.spentOn), method: e.method });
/** An expense was changed. */
export const updatedPayload = (e: ExpenseRow, before: ExpenseRow | undefined) => ({ expenseId: e.id, branchId: e.branchId, amountPaisa: paisaOfRow(e), previousAmountPaisa: paisaOfRow(before ?? e) });
/** An expense was deleted (soft). */
export const deletedPayload = (e: ExpenseRow) => ({ expenseId: e.id, branchId: e.branchId, amountPaisa: paisaOfRow(e) });
/** A recurring draft was skipped. */
export const skippedPayload = (e: ExpenseRow) => ({ expenseId: e.id, recurringId: e.recurringId, forMonth: e.forMonth });
/** A recurring expense made this month's draft. */
export const draftCreatedPayload = (a: { recurringId: string; expenseId: string; forMonth: string; branchId: string }) => ({ ...a });
