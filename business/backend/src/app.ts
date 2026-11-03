import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { mailRoutes } from "./modules/mail/routes.js";
import { teamRoutes } from "./modules/team/routes.js";
import { listingRoutes } from "./modules/listings/routes.js";
import { leadRoutes } from "./modules/leads/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import { hotelRoutes } from "./modules/hotel/routes.js";
import { posRoutes } from "./modules/pos/routes.js";
import { projectRoutes } from "./modules/projects/routes.js";
import { growthRoutes } from "./modules/growth/routes.js";
import type { AiClient } from "@sheetal/backend-core/lib/ai";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import type { Resolver } from "./modules/mail/dns.js";

// Business API: the business panel (/business). Shared basics come from backend-core; each module adds its routes.
// Modules so far: workspaces and team (members, invitations, roles), email (own domains, team mailboxes),
// listings (sent to Sheetal for review, moved between businesses), leads (website enquiries in the Inbox),
// billing (invoices, eSewa, Khalti, Fonepay and bank transfer), hotels (rooms, bookings, front desk), POS (menu,
// shifts, bills), developer projects (units, reservations, collections), sponsor investments, and growth
// (AI lead finding, analytics, calendar sync with other sites, WhatsApp / Messenger / Instagram).
export async function buildApp(config: Config, deps: AppDeps & { resolver?: Resolver; fetch?: Fetch; ai?: { client: AiClient; model: string; credits: Record<string, number> } } = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(teamRoutes, { prefix: "/v1" });
  await app.register(mailRoutes, { prefix: "/v1", resolver: deps.resolver });
  await app.register(listingRoutes, { prefix: "/v1" });
  await app.register(leadRoutes, { prefix: "/v1", fetch: deps.fetch });
  await app.register(billingRoutes, { prefix: "/v1", fetch: deps.fetch });
  await app.register(hotelRoutes, { prefix: "/v1" });
  await app.register(posRoutes, { prefix: "/v1" });
  await app.register(projectRoutes, { prefix: "/v1" });
  await app.register(growthRoutes, { prefix: "/v1", ai: deps.ai, fetch: deps.fetch });
  return app;
}
