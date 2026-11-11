// Expenses, recurring expenses and profit: what a business spent, and what is left of what it received.
// Where it fits: Business → Expenses (apps/expenses/frontend/pages/ExpensesPage.jsx): the Expenses, Recurring and Profit tabs. business/backend/src/app.ts registers expenseRoutes
// with { prefix: "/v1", contextOf: businessContextOf }; business/backend/src/modules/expenses/routes.ts is a one-line shim over this file.
// How it works: an expense belongs to one branch, with a date, category (from the admin option list), amount, vendor, note, payment method and an optional receipt
// (photo or PDF, kept private and opened only through this API). A recurring expense is a monthly template: a background job (and the page when it opens) adds
// this month's draft once its day has come; the business confirms it (the amount can be changed first) or skips it. Only confirmed expenses count in profit
// (see profit.ts). The code is split by job: expense.repository.ts (tables), expense.service.ts (rules), expense.controller.ts (HTTP), presenter.ts (answers).
// Rules: expenses.expense.read / create / update / delete / confirm, expenses.recurring.* and expenses.profit.read (a role that still holds expenses.view or
// expenses.manage passes through the alias layer); every expense belongs to one branch and people only see and change their branches'; "Other" needs a note; a
// draft made by a recurring expense is never deleted, only skipped, so the job can't add it again.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { ExpenseController, RecurringController } from "./expense.controller.js";
import { ExpenseService, RecurringExpenseService, type ExpenseServiceDeps } from "./expense.service.js";
import { busOf } from "@sheetal/platform/core/host";
import { dbOf, draftEventsOf, mediaDirOf } from "./host.js";
import { generateDueExpenses } from "./recurring.js";
import { phaseOneContext } from "./scope.js";

export interface ExpenseRoutesOptions {
  /** Builds the context of a request (business/backend/src/modules/access.ts businessContextOf). Passed in because an app does not import an API. */
  contextOf: (req: FastifyRequest) => Promise<BusinessContext>;
}

export async function expenseRoutes(app: FastifyInstance, opts: ExpenseRoutesOptions) {
  const deps = {
    bus: busOf(app, "expenses"),
    mediaDir: () => mediaDirOf(app),
    // The approval gate the business API decorates before it registers the apps (business/backend/src/app.ts); absent elsewhere (then nothing is ever held).
    approvals: (app as unknown as { approvals?: ExpenseServiceDeps["approvals"] }).approvals,
    generateDue: (tenantId: string) => generateDueExpenses(dbOf(app), { today: nepalDay(), tenantId, events: draftEventsOf(app) }),
  };
  const contextOf = async (req: FastifyRequest) => phaseOneContext(await opts.contextOf(req));
  new ExpenseController(new ExpenseService(deps), contextOf).register(app);
  new RecurringController(new RecurringExpenseService(deps), contextOf).register(app);
}
