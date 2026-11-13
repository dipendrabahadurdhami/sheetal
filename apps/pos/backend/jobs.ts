// The POS app's job: tells the people who run stock which items are low, once a day each (checked every 6 hours; safe to repeat). Moved from
// business/backend/src/modules/stock/routes.ts (P2-W4) unchanged. business/backend/src/jobs.ts registers it.

import type { FastifyInstance } from "fastify";
import { startJobs, type JobSpec } from "@sheetal/platform/jobs/registry";
import { dbOf } from "@sheetal/platform/db/client";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { runLowStock } from "@sheetal/backend-core/domain/stock";

export const stockJob = (app: FastifyInstance): JobSpec => ({
  id: "stock.low", everyMs: 6 * 3600_000, firstRunMs: 70_000, failMessage: "low stock failed",
  run: () => runLowStock(dbOf(app as never), { today: nepalDay() }).then((r) => { if (r.notes) app.log.info(r, "low stock"); }),
});
/** The old entry point, kept as a shim over the jobs registry (it starts the job on its own, as before). */
export function startStockJob(app: FastifyInstance) { startJobs(app, [stockJob(app)], { enabled: true }); }
