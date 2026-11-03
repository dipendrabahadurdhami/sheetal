import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { adminRoutes } from "./modules/routes.js";
import { adminListingRoutes } from "./modules/listings.js";
import { adminPlanRoutes } from "./modules/plans.js";
import { adminContentRoutes } from "./modules/content.js";
import { adminBillingRoutes, startBillingJob } from "./modules/billing.js";

// Admin API: the admin panel (/admin): Sheetal staff managing businesses, plans, moderation and settings.
// Shared basics come from backend-core. So far: businesses, plan changes and suspensions, upgrade requests, staff, audit log,
// plans and prices, the listing review queue, content (blog, careers, buyer requirements and their fee),
// and billing (payments, invoices, gateway keys, the renewal cycle).
export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(adminRoutes, { prefix: "/v1" });
  await app.register(adminListingRoutes, { prefix: "/v1" });
  await app.register(adminPlanRoutes, { prefix: "/v1" });
  await app.register(adminContentRoutes, { prefix: "/v1" });
  await app.register(adminBillingRoutes, { prefix: "/v1" });
  // The renewal cycle (reminders, past due, back to Starter) runs in this process only. JOBS=off turns it off.
  if (config.NODE_ENV !== "test" && process.env.JOBS !== "off" && app.db) startBillingJob(app);
  return app;
}
