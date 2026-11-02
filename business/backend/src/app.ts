import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { mailRoutes } from "./modules/mail/routes.js";
import type { Resolver } from "./modules/mail/dns.js";

// Business API: the business panel (/business). Shared basics come from backend-core; each module adds its routes.
// Modules so far: email (own domains, team mailboxes).
export async function buildApp(config: Config, deps: AppDeps & { resolver?: Resolver } = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(mailRoutes, { prefix: "/v1", resolver: deps.resolver });
  return app;
}
