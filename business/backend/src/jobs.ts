// The business API's background jobs, listed in one place.
// Where it fits: app.ts calls startJobs(app, businessJobs(app), ...) once, at the end of buildApp(). The jobs themselves live next to the
// code they run (each module exports its JobSpec); this file only lists them. Jobs of the admin API are listed in admin/backend/src/jobs.ts.
// How it works: platform/src/jobs/registry.ts starts one timer pair per job and stops them all when the app closes. The event
// dispatcher is the last job in the list; it has no handlers until an app declares events.consumes in its manifest (P1-BE-5 onwards).
// Rules: intervals and first-run delays are the ones the jobs had as separate timers (expenses 45 s / 6 h, rentals 50 s / 6 h, stock
// 70 s / 6 h, check-ups no first run / 15 min); the business API runs none of the admin API's jobs. JOBS=off turns all of them off.

import type { FastifyInstance } from "fastify";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { createDispatcher } from "@sheetal/platform/jobs/dispatcher";
import { PrismaOutboxStore } from "@sheetal/platform/jobs/outbox-store";
import type { JobSpec } from "@sheetal/platform/jobs/registry";
import type { ConsumerImpls } from "@sheetal/platform/jobs/consumers";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { buildSystemContext } from "@sheetal/platform/tenancy/system-context";
import { OutboxEventBus } from "@sheetal/platform/core/events";
import { expenseJob } from "@sheetal/app-expenses/backend";
import { rentJob } from "./modules/rentals/routes.js";
import { reviewCheckupJob } from "./modules/reviews/checkups.js";
import { stockJob } from "./modules/stock/routes.js";
import { approvalExpiryJob } from "@sheetal/platform/approvals/jobs";
import { demoCleanupJob } from "./modules/demo/routes.js";
import type { ApprovalService } from "@sheetal/platform/approvals/service";

/**
 * The bus the apps of this API subscribe to, and its dispatcher. One per process. Apps register their handlers on `bus` from their
 * manifests with registerConsumers() (platform/src/jobs/consumers.ts) before the first tick; today none declares events.consumes.
 */
export function eventsOf(app: FastifyInstance) {
  const bus = new OutboxEventBus();
  const db = dbOf(app);
  const dispatcher = createDispatcher({
    store: new PrismaOutboxStore(db), bus, db, log: app.log,
    contexts: { forBusiness: (a) => buildSystemContext({ db, log: app.log, ...a }, { effectiveLimits: (d, tenantId, plan) => effectiveLimits(d, tenantId, plan) }) },
  });
  return { bus, dispatcher };
}

/** The code of every event handler of the apps in this API, by handler id (empty until an app consumes an event, P1-BE-5 onwards). */
export const CONSUMERS: ConsumerImpls = {};

declare module "fastify" {
  interface FastifyInstance { events?: ReturnType<typeof eventsOf>; approvals?: ApprovalService }
}

/** Every background job of the business API, in start order. `events` is what eventsOf(app) returned (the same bus the apps subscribed to). */
export function businessJobs(app: FastifyInstance, events: ReturnType<typeof eventsOf>): JobSpec[] {
  return [expenseJob(app), rentJob(app), stockJob(app), reviewCheckupJob(app), events.dispatcher.job()];
}

/**
 * Jobs that belong to the platform, not to one app (P1-BE-7): the approvals expiry and the hourly cleanup of demo businesses (stage 1.2). Listed apart from businessJobs() on purpose, so that list (and the test
 * that pins it) stays as the apps' own jobs; app.ts starts both lists in one registry.
 */
export function platformJobs(app: FastifyInstance): JobSpec[] {
  return [approvalExpiryJob(dbOf(app), app.log), demoCleanupJob(app)];
}
