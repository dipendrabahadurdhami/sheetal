// Admin API (port 4002): everything the super-admin panel (/admin) needs, for Sheetal staff only.
// Where it fits: server.ts starts it; tests build it with buildApp(); the admin panel calls it under /v1/admin.
// How it works: the shared base app (backend-core) plus modules for businesses and staff, plans, listing review,
// content, billing, payouts, analytics and system status, platform settings and connections (Google, WhatsApp, Cloudflare), business verification, support sessions (log in as a business, read-only by default) and the staff notification bell. It also
// runs two background jobs: plan renewals (every 6 hours) and calendar sync (every 2 hours).
// Rules: every route starts with staffOf(request, permission); businesses get nothing here.

import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { adminRoutes } from "./modules/routes.js";
import { adminListingRoutes } from "./modules/listings.js";
import { adminPlanRoutes } from "./modules/plans.js";
import { adminContentRoutes } from "./modules/content.js";
import { adminBillingRoutes } from "./modules/billing.js";
import { adminPayoutRoutes } from "./modules/payouts.js";
import { adminRentPaymentRoutes } from "./modules/rent-payments.js";
import { adminAddonRoutes } from "./modules/addons.js";
import { adminEarningsRoutes } from "./modules/earnings.js";
import { adminDashboardRoutes } from "./modules/dashboard.js";
import { adminPromoteRoutes } from "./modules/promote.js";
import { adminLeadRoutes } from "./modules/leads.js";
import { adminInsightRoutes } from "./modules/insight.js";
import { adminPlatformRoutes } from "./modules/platform.js";
import { adminChannelRoutes } from "./modules/channels.js";
import { adminAiFeatureRoutes } from "./modules/ai-features.js";
import { adminTemplateRoutes } from "./modules/templates.js";
import { adminReminderRoutes } from "./modules/reminders.js";
import { adminJobs } from "./jobs.js";
import { jobsOn, startJobs } from "@sheetal/platform/jobs/registry";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { notificationRoutes } from "@sheetal/backend-core/modules/notifications";
import { adminVerificationRoutes } from "./modules/verification.js";
import { adminCatalogRoutes } from "./modules/catalog.js";
import { adminSupportRoutes } from "./modules/support.js";
import { adminImpersonationRoutes } from "./modules/impersonation.js";
import { staffOf } from "./modules/routes.js";

export async function buildApp(config: Config, deps: AppDeps & { fetch?: Fetch } = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(adminRoutes, { prefix: "/v1" });
  await app.register(adminListingRoutes, { prefix: "/v1" });
  await app.register(adminPlanRoutes, { prefix: "/v1" });
  await app.register(adminContentRoutes, { prefix: "/v1" });
  await app.register(adminBillingRoutes, { prefix: "/v1" });
  await app.register(adminPayoutRoutes, { prefix: "/v1" });
  await app.register(adminRentPaymentRoutes, { prefix: "/v1" });
  await app.register(adminAddonRoutes, { prefix: "/v1" });
  await app.register(adminEarningsRoutes, { prefix: "/v1" });
  await app.register(adminDashboardRoutes, { prefix: "/v1" });
  await app.register(adminPromoteRoutes, { prefix: "/v1" });
  await app.register(adminLeadRoutes, { prefix: "/v1" });
  await app.register(adminInsightRoutes, { prefix: "/v1" });
  await app.register(adminPlatformRoutes, { prefix: "/v1", fetch: deps.fetch });
  await app.register(adminChannelRoutes, { prefix: "/v1" });
  await app.register(adminAiFeatureRoutes, { prefix: "/v1" });
  await app.register(adminTemplateRoutes, { prefix: "/v1" });
  await app.register(adminReminderRoutes, { prefix: "/v1" });
  await app.register(adminVerificationRoutes, { prefix: "/v1" });
  await app.register(adminCatalogRoutes, { prefix: "/v1" });
  await app.register(adminSupportRoutes, { prefix: "/v1" });
  await app.register(adminImpersonationRoutes, { prefix: "/v1" });
  // The bell: work for Sheetal staff (notes without a business that lead into the admin panel).
  await app.register(async (a) => notificationRoutes(a, "/admin/notifications", (request) => ({ userId: staffOf(request).user.id, tenantId: null, link: { startsWith: "/admin" } })), { prefix: "/v1" });
  // The renewal cycle, calendar sync and expiry reminders run in this process only, started by one registry (src/jobs.ts). JOBS=off turns them off.
  startJobs(app, adminJobs(app), { enabled: jobsOn(config.NODE_ENV, !!app.db) });
  return app;
}
