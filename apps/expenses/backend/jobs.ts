// The background job of Expenses: add this month's drafts for recurring expenses.
// Where it fits: moved here from the old routes file (P1-BE-5). business/backend/src/jobs.ts lists expenseJob(app) with the other jobs of the business API;
// startExpenseJob() is the old entry point, kept as a shim over the same spec.
// How it works: every 6 hours (first run 45 s after start) generateDueExpenses() adds one draft per recurring expense and month, each with its event in the
// same transaction, then tells the team. The page also adds due drafts when it opens, so nothing waits for the job.
// Rules: id "expenses.recurring" and the 45 s / 6 h timing are the ones tests and logs already know; JOBS=off still turns it off (the registry decides).

import type { FastifyInstance } from "fastify";
import { startJobs, type JobSpec } from "@sheetal/platform/jobs/registry";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { dbOf, draftEventsOf } from "./host.js";
import { generateDueExpenses } from "./recurring.js";

export const expenseJob = (app: FastifyInstance, o: { allowNoBus?: boolean } = {}): JobSpec => ({
  id: "expenses.recurring", everyMs: 6 * 3600_000, firstRunMs: 45_000, failMessage: "recurring expenses failed",
  run: () => generateDueExpenses(dbOf(app), { today: nepalDay(), events: draftEventsOf(app, o) })
    .then((n) => { if (n) app.log.info({ drafts: n }, "recurring expenses"); }),
});

/** The old entry point, kept as a shim over the jobs registry (it starts the job on its own, as before). */
export function startExpenseJob(app: FastifyInstance) { startJobs(app, [expenseJob(app, { allowNoBus: true })], { enabled: true }); }
