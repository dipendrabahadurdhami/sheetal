// The background job of Rentals: make rent bills and add late fees.
// Where it fits: moved here from the old routes file (P2-W1-S1). business/backend/src/jobs.ts lists rentJob(app) with the other jobs of the business API (it imports it through
// the one-line shim modules/rentals/routes.ts); startRentJob() is the old entry point, kept as a shim over the same spec.
// How it works: every 6 hours (first run 50 s after start) runBills makes one bill per running lease and month, and adds a late fee once when a bill is still unpaid some days
// after its due date, each with its event in the same transaction. The Rentals page also runs it when it opens, so nothing waits for the job.
// Rules: id "rentals.bills" and the 50 s / 6 h timing are the ones tests and logs already know; JOBS=off still turns it off (the registry decides).

import type { FastifyInstance } from "fastify";
import { startJobs, type JobSpec } from "@sheetal/platform/jobs/registry";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { runRentBills } from "./bills.js";
import { billEventsOf, dbOf } from "./host.js";

export const rentJob = (app: FastifyInstance, o: { allowNoBus?: boolean } = {}): JobSpec => ({
  id: "rentals.bills", everyMs: 6 * 3600_000, firstRunMs: 50_000, failMessage: "rent bills failed",
  run: () => runRentBills(dbOf(app), { today: nepalDay(), events: billEventsOf(app, o) })
    .then((r) => { if (r.bills || r.lateFees) app.log.info(r, "rent bills"); }),
});

/** The old entry point, kept as a shim over the jobs registry (it starts the job on its own, as before). */
export function startRentJob(app: FastifyInstance) { startJobs(app, [rentJob(app, { allowNoBus: true })], { enabled: true }); }
