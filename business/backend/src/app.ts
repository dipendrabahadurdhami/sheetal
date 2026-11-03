import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { mailRoutes } from "./modules/mail/routes.js";
import { teamRoutes } from "./modules/team/routes.js";
import { listingRoutes } from "./modules/listings/routes.js";
import { leadRoutes } from "./modules/leads/routes.js";
import { billingRoutes } from "./modules/billing/routes.js";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import type { Resolver } from "./modules/mail/dns.js";

// Business API: the business panel (/business). Shared basics come from backend-core; each module adds its routes.
// Modules so far: workspaces and team (members, invitations, roles), email (own domains, team mailboxes),
// listings (sent to Sheetal for review, moved between businesses), leads (website enquiries in the Inbox),
// billing (invoices, eSewa, Khalti, Fonepay and bank transfer).
export async function buildApp(config: Config, deps: AppDeps & { resolver?: Resolver; fetch?: Fetch } = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(teamRoutes, { prefix: "/v1" });
  await app.register(mailRoutes, { prefix: "/v1", resolver: deps.resolver });
  await app.register(listingRoutes, { prefix: "/v1" });
  await app.register(leadRoutes, { prefix: "/v1" });
  await app.register(billingRoutes, { prefix: "/v1", fetch: deps.fetch });
  return app;
}
