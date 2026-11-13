// Business API (port 4001): everything the business panel (/business) needs.
// Where it fits: server.ts starts it; tests build it with buildApp(); the business panel calls it under /v1.
// How it works: the shared base app (backend-core) plus one module per area: team and businesses, branches,
// listings, leads, email, billing, hotel and calendar, point of sale, projects and investments, growth (AI,
// analytics, channels, calendar sync), reviews and verification, settings and check-ups, import and export, customer invoices, payouts, expenses and profit, rentals, online forms, agreements, promote (boosts and home banners), stock, and the
// notification bell.
// Rules: every route starts from workspaceOf() (modules/access.ts), so it always acts inside one business the
// person belongs to, with their role, and only on the branches they work at. A Sheetal support session (a token from the admin API, read-only by
// default) is accepted by the hook registered right after the base app, and then looks like a sign-in to that one business (platform/src/support).

import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/platform/core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { mailRoutes } from "./modules/mail/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { addonRoutes } from "./modules/billing/addons.js";
import { growthRoutes } from "./modules/growth/routes.js";
import { otaRoutes } from "./modules/ota/routes.js";
import { supportRoutes } from "./modules/support/routes.js";
import { reviewRoutes } from "@sheetal/app-reviews/backend";
import { verificationRoutes } from "./modules/verification/routes.js";
import { dataRoutes } from "./modules/data/routes.js";
import { expenseRoutes } from "@sheetal/app-expenses/backend";
import { rentalRoutes } from "@sheetal/app-rentals/backend";
import { peopleRoutes } from "@sheetal/app-people/backend";
import { agreementRoutes } from "@sheetal/app-agreements/backend";
import { projectRoutes } from "@sheetal/app-projects/backend";
import { investmentRoutes } from "@sheetal/app-investments/backend";
import { invoicingRoutes } from "@sheetal/app-invoicing/backend";
import { posRoutes } from "@sheetal/app-pos/backend";
import { hotelRoutes } from "@sheetal/app-hotel/backend";
import { leadRoutes } from "@sheetal/app-crm/backend";
import { listingRoutes } from "@sheetal/app-listings/backend";
import { workspaceRoutes } from "@sheetal/app-workspace/backend";
import { listingCodeRoutes } from "./modules/listings/codes.js";
import { formRoutes } from "./modules/forms/routes.js";
import { promoteRoutes } from "./modules/promote/routes.js";
import { bannerRoutes } from "./modules/promote/banners.js";
import { overviewRoutes } from "./modules/overview/routes.js";
import { devKeyRoutes } from "./modules/devkeys/routes.js";
import { aiAccountRoutes } from "./modules/aiaccount/routes.js";
import { reviewRoutes as checkupRoutes } from "./modules/reviews/checkups.js";
import { notificationRoutes } from "@sheetal/backend-core/modules/notifications";
import { businessContextOf, workspaceOf } from "./modules/access.js";
import { CONSUMERS, businessJobs, eventsOf, platformJobs } from "./jobs.js";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { ApprovalService } from "@sheetal/platform/approvals/service";
import { approvalRoutes } from "@sheetal/platform/approvals/routes";
import { registerSupportSessions } from "@sheetal/platform/support/hooks";
import { supportSessionRoutes } from "@sheetal/platform/support/routes";
import { registerDemoGuard } from "@sheetal/platform/demo/guard";
import { DEMO_ALLOW, demoRoutes } from "./modules/demo/routes.js";
import { registerConsumers } from "@sheetal/platform/jobs/consumers";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import { jobsOn, startJobs } from "@sheetal/platform/jobs/registry";
import type { AiClient } from "@sheetal/backend-core/lib/ai";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import type { Resolver } from "./modules/mail/dns.js";

export async function buildApp(config: Config, deps: AppDeps & { resolver?: Resolver; fetch?: Fetch; ai?: { client: AiClient; model: string; credits: Record<string, number> } } = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  // Before any route: a hook only covers the routes registered after it. Support-session tokens (read-only by default) are recognised here.
  registerSupportSessions(app);
  // "Try the demo" (stage 1.2): a demo visitor may only change what DEMO_ALLOW lists; everything that reaches outside (invitations, mail, payments, uploads) is refused.
  registerDemoGuard(app, { allow: DEMO_ALLOW });
  await app.register(demoRoutes, { prefix: "/v1", fetch: deps.fetch });
  // Maker-checker approvals (P1-BE-7): the gate for services that name an `approval` on an action, the inbox and rules routes. Every rule is OFF in Phase 1.
  const approvals = new ApprovalService({ tenancy: { effectiveLimits: (db, tenantId, plan) => effectiveLimits(db, tenantId, plan) } });
  app.decorate("approvals", approvals);
  await app.register(approvalRoutes, { prefix: "/v1", contextOf: businessContextOf, service: approvals });
  await app.register(supportSessionRoutes, { prefix: "/v1" });
  await app.register(workspaceRoutes, { prefix: "/v1", contextOf: businessContextOf });   // branches, business settings, check-ups, the team
  await app.register(reviewRoutes, { prefix: "/v1", contextOf: businessContextOf });
  await app.register(verificationRoutes, { prefix: "/v1" });
  await app.register(dataRoutes, { prefix: "/v1" });
  await app.register(invoicingRoutes, { prefix: "/v1", contextOf: businessContextOf });   // customer invoices and payouts
  // Expenses is the first app on the kernel (P1-BE-5): its code lives in apps/expenses/backend; it gets the request-context builder from here.
  await app.register(expenseRoutes, { prefix: "/v1", contextOf: businessContextOf });
  // Rentals is on the kernel too (P2-W1-S1): its code lives in apps/rentals/backend; same way as Expenses.
  await app.register(rentalRoutes, { prefix: "/v1", contextOf: businessContextOf });
  await app.register(listingCodeRoutes, { prefix: "/v1" });
  await app.register(checkupRoutes, { prefix: "/v1" });
  await app.register(formRoutes, { prefix: "/v1" });
  await app.register(agreementRoutes, { prefix: "/v1", contextOf: businessContextOf });
  await app.register(promoteRoutes, { prefix: "/v1" });
  await app.register(bannerRoutes, { prefix: "/v1" });
  await app.register(overviewRoutes, { prefix: "/v1" });
  await app.register(peopleRoutes, { prefix: "/v1", contextOf: businessContextOf });
  await app.register(devKeyRoutes, { prefix: "/v1" });
  await app.register(aiAccountRoutes, { prefix: "/v1", ai: deps.ai });
  // The bell: the person's notifications about the open business.
  await app.register(async (a) => notificationRoutes(a, "/notifications", (request) => { const ws = workspaceOf(request); return { userId: ws.user.id, tenantId: ws.tenantId }; }), { prefix: "/v1" });
  await app.register(mailRoutes, { prefix: "/v1", resolver: deps.resolver });
  await app.register(listingRoutes, { prefix: "/v1", contextOf: businessContextOf });
  await app.register(leadRoutes, { prefix: "/v1", contextOf: businessContextOf, fetch: deps.fetch });
  await app.register(billingRoutes, { prefix: "/v1", fetch: deps.fetch });
  await app.register(addonRoutes, { prefix: "/v1" });
  await app.register(hotelRoutes, { prefix: "/v1", contextOf: businessContextOf });
  await app.register(posRoutes, { prefix: "/v1", contextOf: businessContextOf });   // point of sale and stock
  await app.register(projectRoutes, { prefix: "/v1", contextOf: businessContextOf });
  await app.register(investmentRoutes, { prefix: "/v1", contextOf: businessContextOf });
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
    startJobs(app, [...businessJobs(app, events), ...platformJobs(app)], { enabled: jobsOn(config.NODE_ENV, true) });
  }
  return app;
}
