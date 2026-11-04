// Admin API (port 4002): everything the super-admin panel (/admin) needs, for Sheetal staff only.
// Where it fits: server.ts starts it; tests build it with buildApp(); the admin panel calls it under /v1/admin.
// How it works: the shared base app (backend-core) plus modules for businesses and staff, plans, listing review,
// content, billing, analytics and system status, business verification and the staff notification bell. It also
// runs two background jobs: plan renewals (every 6 hours) and calendar sync (every 2 hours).
// Rules: every route starts with staffOf(request, permission); businesses get nothing here.

import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { adminRoutes } from "./modules/routes.js";
import { adminListingRoutes } from "./modules/listings.js";
import { adminPlanRoutes } from "./modules/plans.js";
import { adminContentRoutes } from "./modules/content.js";
import { adminBillingRoutes, startBillingJob } from "./modules/billing.js";
import { adminInsightRoutes, startOtaJob } from "./modules/insight.js";
import { notificationRoutes } from "@sheetal/backend-core/modules/notifications";
import { adminVerificationRoutes } from "./modules/verification.js";
import { adminCatalogRoutes } from "./modules/catalog.js";
import { staffOf } from "./modules/routes.js";

export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(adminRoutes, { prefix: "/v1" });
  await app.register(adminListingRoutes, { prefix: "/v1" });
  await app.register(adminPlanRoutes, { prefix: "/v1" });
  await app.register(adminContentRoutes, { prefix: "/v1" });
  await app.register(adminBillingRoutes, { prefix: "/v1" });
  await app.register(adminInsightRoutes, { prefix: "/v1" });
  await app.register(adminVerificationRoutes, { prefix: "/v1" });
  await app.register(adminCatalogRoutes, { prefix: "/v1" });
  // The bell: work for Sheetal staff (notes without a business that lead into the admin panel).
  await app.register(async (a) => notificationRoutes(a, "/admin/notifications", (request) => ({ userId: staffOf(request).user.id, tenantId: null, link: { startsWith: "/admin" } })), { prefix: "/v1" });
  // The renewal cycle and calendar sync run in this process only. JOBS=off turns them off.
  if (config.NODE_ENV !== "test" && process.env.JOBS !== "off" && app.db) { startBillingJob(app); startOtaJob(app); }
  return app;
}
