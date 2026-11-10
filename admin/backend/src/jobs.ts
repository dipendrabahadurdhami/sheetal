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
import { billingJob } from "./modules/billing.js";
import { otaJob } from "./modules/insight.js";
import { reminderJob } from "./modules/reminders.js";

/** Every background job of the admin API, in start order. */
export const adminJobs = (app: FastifyInstance): JobSpec[] => [billingJob(app), otaJob(app), reminderJob(app)];
