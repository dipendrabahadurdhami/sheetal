// Decides yesterday's (and older) check-up changes on their own, every 15 minutes, in the business API (jobs registry). No first run at start: the first
// run is after 15 minutes, as before. Moved from business/backend/src/modules/reviews/checkups.ts in P2-W6.
// How it works: one transaction per business: the decisions and a "listings.checkup.decided" event (actor: this job).

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import type { JobSpec } from "@sheetal/platform/jobs/registry";
import { busOf } from "@sheetal/platform/core/host";
import { CheckupRepository } from "./checkup.repository.js";
import { decideChanges, nepalDay } from "./checkup.service.js";

type Tx = Prisma.TransactionClient;

export const checkupJob = (app: FastifyInstance): JobSpec => ({
  id: "reviews.checkups", everyMs: 15 * 60 * 1000, firstRunMs: null,
  run: async () => {
    const db = (app as FastifyInstance & { db: { $transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> } & Tx }).db;
    const bus = busOf(app, "listings");
    const today = nepalDay();
    for (const t of await new CheckupRepository().businessesWithUndecided(db, today)) {
      await db.$transaction(async (tx) => {
        const r = await decideChanges(tx, t.tenantId, today);
        const ctx = { requestId: "job:reviews.checkups", ip: "", now: new Date(), log: app.log, db, tx, actor: { kind: "system", job: "reviews.checkups" }, business: { id: t.tenantId } };
        await bus.publish(ctx as never, "listings.checkup.decided", { applied: r.applied, conflicts: r.conflicts }, 1);
      }).catch((e) => app.log.error(e, "checkup decide failed"));
    }
  },
});
