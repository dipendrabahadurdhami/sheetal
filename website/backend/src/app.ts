import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes, mediaRoutes } from "./modules/catalog/routes.js";

// Website API: accounts and login, and the public catalogue (properties, search, map, agencies, photos).
// Shared basics come from backend-core.
export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(catalogRoutes, { prefix: "/v1" });
  await app.register(mediaRoutes);
  return app;
}
