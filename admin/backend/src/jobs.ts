// The admin API's background jobs, listed in one place.
// Where it fits: app.ts calls startJobs(app, adminJobs(app), ...) once, at the end of buildApp(). The jobs live next to the code they
// run (each module exports its JobSpec); this file only lists them. Jobs of the business API are listed in business/backend/src/jobs.ts.
// How it works: platform/src/jobs/registry.ts starts one timer pair per job and stops them all when the app closes.
// Rules: intervals and first-run delays are the ones the jobs had as separate timers (billing renewal 30 s / 6 h, calendar sync
// 60 s / 2 h, expiry reminders 120 s / 1 h). Only one admin API process should run them. The admin API does not run the event
// dispatcher: handlers belong to apps, which run in the business API (events published by the admin API are delivered there).
// JOBS=off turns all of them off.

import type { FastifyInstance } from "fastify";
import type { JobSpec } from "@sheetal/platform/jobs/registry";
import { billingJob, subscriptionJob } from "./modules/billing.js";
import { otaJob } from "./modules/insight.js";
import { reminderJob } from "./modules/reminders.js";
import { dbOf } from "@sheetal/platform/db/client";
import { Vault } from "@sheetal/platform/auth/vault";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { IntegrationService } from "@sheetal/platform/integrations/service";
import { syncLegacy } from "@sheetal/platform/integrations/legacy";
import { integrationHealthJob } from "@sheetal/platform/integrations/health";

/** Every background job of the admin API, in start order. */
export const adminJobs = (app: FastifyInstance): JobSpec[] => [billingJob(app), otaJob(app), reminderJob(app)];

/**
 * The Integration Center's engine for this API (stage 1.3): one per process. After every change to a platform connection the old settings rows are
 * rewritten (syncLegacy), so billing's gateways() and the website keep reading what they always read.
 */
export function integrationsOf(app: FastifyInstance, fetchFn?: Fetch): IntegrationService {
  const db = dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const env = app.config.NODE_ENV === "production" ? "production" : app.config.NODE_ENV === "test" ? "test" : "development";
  return new IntegrationService({ db, vault, env, fetch: fetchFn, log: app.log, afterChange: (id) => syncLegacy(db, vault, id) });
}

/** Jobs of the platform itself that run in this API, listed apart from adminJobs() so that list (and the test that pins it) stays as it was. */
export const adminPlatformJobs = (app: FastifyInstance, integrations: IntegrationService): JobSpec[] => [integrationHealthJob(dbOf(app), integrations, app.log), subscriptionJob(app)];

declare module "fastify" {
  interface FastifyInstance { integrations?: IntegrationService }
}
