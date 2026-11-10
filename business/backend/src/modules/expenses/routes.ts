// Expenses routes: the code moved to the Expenses app (apps/expenses/backend) in P1-BE-5; this file keeps the old names so nothing that imports it changes.
// Where it fits: tests (jobs.test.ts imports startExpenseJob) and any older import. app.ts and jobs.ts import from "@sheetal/app-expenses/backend" directly.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";
import { expenseRoutes as routes } from "@sheetal/app-expenses/backend";
import { businessContextOf } from "../access.js";

export { expenseJob, startExpenseJob } from "@sheetal/app-expenses/backend";
export const expenseRoutes = (app: FastifyInstance) => routes(app, { contextOf: businessContextOf });
