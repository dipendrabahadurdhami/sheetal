// Adds this month's draft for every recurring expense that has reached its day: the background job, and the page when it opens.
// Where it fits: moved here from backend-core/src/domain/expenses.ts (P1-BE-5); that file re-exports generateDueExpenses. jobs.ts runs it every 6 hours.
// How it works: finds the active templates whose day has come, adds ONE draft per template and month (ExpenseRepository.createDraftIfMissing), and tells the team
// ("N recurring expenses to confirm"). Safe to run again and again: whatever happens, a month gets one draft (a skipped one stays as "skipped"). When `events`
// is given, each new draft and its "expenses.recurring.draft_created" event are written in ONE transaction of that business (a system context, no person);
// without it (an old caller, a test) the draft is added with no event.
// Rules: returns how many drafts were added; tenantId limits it to one business. A failure stops the run and is logged by the job registry; the next run
// picks up where this one stopped (nothing is added twice).

import type { Db } from "@sheetal/platform/db/client";
import { notify, teamWith } from "@sheetal/platform/notify/index";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { draftCreatedPayload, EXPENSE_EVENTS } from "./events.js";
import { RecurringExpenseRepository, ExpenseRepository } from "./expense.repository.js";

/** What publishing an event needs: the bus, and a context of the template's business (acting as the system). */
export interface DraftEvents { bus: EventBus; contextFor(tenantId: string): Promise<BusinessContext> }

export async function generateDueExpenses(db: Db, o: { today: string; tenantId?: string; events?: DraftEvents }): Promise<number> {
  const month = o.today.slice(0, 7);
  const dueDay = Number(o.today.slice(8, 10));
  const templates = await new RecurringExpenseRepository().dueTemplates(db, { month, dueDay, tenantId: o.tenantId });
  const expenses = new ExpenseRepository();
  const contexts = new Map<string, Promise<BusinessContext>>();
  const added = new Map<string, number>();
  for (const t of templates) {
    let id: string | null;
    if (o.events) {
      const events = o.events;
      if (!contexts.has(t.tenantId)) contexts.set(t.tenantId, events.contextFor(t.tenantId));
      const ctx = await contexts.get(t.tenantId)!;
      id = await ctx.transaction(async (tx) => {
        const made = await expenses.createDraftIfMissing(tx.tx!, t, month);
        if (made) await events.bus.publish(tx, EXPENSE_EVENTS.draftCreated, draftCreatedPayload({ recurringId: t.id, expenseId: made, forMonth: month, branchId: t.branchId }), 1, { branchId: t.branchId });
        return made;
      });
    } else {
      id = await expenses.createDraftIfMissing(db, t, month);
    }
    if (id) added.set(t.tenantId, (added.get(t.tenantId) ?? 0) + 1);
  }
  for (const [tenantId, n] of added) {
    await notify(db, await teamWith(db, tenantId, ["expenses.expense.confirm"]), { type: "expense", title: `${n} recurring expense${n > 1 ? "s" : ""} to confirm`, message: "Check the amount and confirm it, so it counts in your profit.", link: "/business/expenses", tenantId }).catch(() => {});
  }
  return [...added.values()].reduce((a, b) => a + b, 0);
}
