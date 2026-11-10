// Business API (port 4001): everything the business panel (/business) needs.
// Where it fits: server.ts starts it; tests build it with buildApp(); the business panel calls it under /v1.
// How it works: the shared base app (backend-core) plus one module per area: team and businesses, branches,
// listings, leads, email, billing, hotel and calendar, point of sale, projects and investments, growth (AI,
// analytics, channels, calendar sync), reviews and verification, settings and check-ups, import and export, customer invoices, payouts, expenses and profit, rentals, online forms, agreements, promote (boosts and home banners), stock, and the
// notification bell.
// Rules: every route starts from workspaceOf() (modules/access.ts), so it always acts inside one business the
// person belongs to, with their role, and only on the branches they work at.

import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { mailRoutes } from "./modules/mail/routes.js";
import { teamRoutes } from "./modules/team/routes.js";
import { listingRoutes } from "./modules/listings/routes.js";
import { leadRoutes } from "./modules/leads/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { addonRoutes } from "./modules/billing/addons.js";
import { hotelRoutes } from "./modules/hotel/routes.js";
import { posRoutes } from "./modules/pos/routes.js";
import { projectRoutes } from "./modules/projects/routes.js";
import { growthRoutes } from "./modules/growth/routes.js";
import { otaRoutes } from "./modules/ota/routes.js";
import { supportRoutes } from "./modules/support/routes.js";
import { branchRoutes } from "./modules/branches/routes.js";
import { reviewRoutes } from "./modules/reviews/routes.js";
import { verificationRoutes } from "./modules/verification/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { dataRoutes } from "./modules/data/routes.js";
import { invoicingRoutes } from "./modules/invoicing/routes.js";
import { payoutRoutes } from "./modules/payouts/routes.js";
import { expenseRoutes } from "./modules/expenses/routes.js";
import { rentalRoutes } from "./modules/rentals/routes.js";
import { listingCodeRoutes } from "./modules/listings/codes.js";
import { formRoutes } from "./modules/forms/routes.js";
import { agreementRoutes } from "./modules/agreements/routes.js";
import { promoteRoutes } from "./modules/promote/routes.js";
import { bannerRoutes } from "./modules/promote/banners.js";
import { overviewRoutes } from "./modules/overview/routes.js";
import { stockRoutes } from "./modules/stock/routes.js";
import { peopleRoutes } from "./modules/people/routes.js";
import { devKeyRoutes } from "./modules/devkeys/routes.js";
import { aiAccountRoutes } from "./modules/aiaccount/routes.js";
import { reviewRoutes as checkupRoutes } from "./modules/reviews/checkups.js";
import { notificationRoutes } from "@sheetal/backend-core/modules/notifications";
import { workspaceOf } from "./modules/access.js";
import { CONSUMERS, businessJobs, eventsOf } from "./jobs.js";
import { registerConsumers } from "@sheetal/platform/jobs/consumers";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import { jobsOn, startJobs } from "@sheetal/platform/jobs/registry";
import type { AiClient } from "@sheetal/backend-core/lib/ai";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import type { Resolver } from "./modules/mail/dns.js";

export async function buildApp(config: Config, deps: AppDeps & { resolver?: Resolver; fetch?: Fetch; ai?: { client: AiClient; model: string; credits: Record<string, number> } } = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(teamRoutes, { prefix: "/v1" });
  await app.register(branchRoutes, { prefix: "/v1" });
  await app.register(reviewRoutes, { prefix: "/v1" });
  await app.register(verificationRoutes, { prefix: "/v1" });
  await app.register(settingsRoutes, { prefix: "/v1" });
  await app.register(dataRoutes, { prefix: "/v1" });
  await app.register(invoicingRoutes, { prefix: "/v1" });
  await app.register(payoutRoutes, { prefix: "/v1" });
  await app.register(expenseRoutes, { prefix: "/v1" });
  await app.register(rentalRoutes, { prefix: "/v1" });
  await app.register(listingCodeRoutes, { prefix: "/v1" });
  await app.register(checkupRoutes, { prefix: "/v1" });
  await app.register(formRoutes, { prefix: "/v1" });
  await app.register(agreementRoutes, { prefix: "/v1" });
  await app.register(promoteRoutes, { prefix: "/v1" });
  await app.register(bannerRoutes, { prefix: "/v1" });
  await app.register(overviewRoutes, { prefix: "/v1" });
  await app.register(stockRoutes, { prefix: "/v1" });
  await app.register(peopleRoutes, { prefix: "/v1" });
  await app.register(devKeyRoutes, { prefix: "/v1" });
  await app.register(aiAccountRoutes, { prefix: "/v1", ai: deps.ai });
  // The bell: the person's notifications about the open business.
  await app.register(async (a) => notificationRoutes(a, "/notifications", (request) => { const ws = workspaceOf(request); return { userId: ws.user.id, tenantId: ws.tenantId }; }), { prefix: "/v1" });
  await app.register(mailRoutes, { prefix: "/v1", resolver: deps.resolver });
  await app.register(listingRoutes, { prefix: "/v1" });
  await app.register(leadRoutes, { prefix: "/v1", fetch: deps.fetch });
  await app.register(billingRoutes, { prefix: "/v1", fetch: deps.fetch });
  await app.register(addonRoutes, { prefix: "/v1" });
  await app.register(hotelRoutes, { prefix: "/v1" });
  await app.register(posRoutes, { prefix: "/v1" });
  await app.register(projectRoutes, { prefix: "/v1" });
  await app.register(growthRoutes, { prefix: "/v1", ai: deps.ai, fetch: deps.fetch });
  await app.register(otaRoutes, { prefix: "/v1" });
  await app.register(supportRoutes, { prefix: "/v1" });
  // Background jobs of this process (recurring expenses, rent bills, low-stock alerts, listing check-ups, the event dispatcher) are
  // started by one registry (src/jobs.ts). JOBS=off turns them all off. The event bus is where apps will subscribe their handlers.
  // The bus stays on the app (app.events) so the apps moved onto the kernel (P1-BE-5 onwards) subscribe to the same bus the dispatcher
  // runs. registerConsumers() runs at boot so a manifest that lists a handler with no code (or code with no manifest entry) stops the start.
  if (app.db) {
    const events = eventsOf(app);
    app.decorate("events", events);
    registerConsumers(events.bus, APPS, CONSUMERS);
    startJobs(app, businessJobs(app, events), { enabled: jobsOn(config.NODE_ENV, true) });
  }
  return app;
}
