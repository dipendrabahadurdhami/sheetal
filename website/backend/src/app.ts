import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes, mediaRoutes } from "./modules/catalog/routes.js";
import { engageRoutes } from "./modules/engage/routes.js";
import { postingRoutes } from "./modules/posting/routes.js";
import { contentRoutes } from "./modules/content/routes.js";
import { boardRoutes } from "./modules/board/routes.js";
import { insightRoutes } from "./modules/insight/routes.js";
import type { AiClient } from "@sheetal/backend-core/lib/ai";

// Website API: accounts and login, the public catalogue (properties, search, map, agencies, photos),
// and what visitors do: favourites, enquiries, reviews, posting their own listings, plans and upgrades;
// the requirement board with offers, notifications, blog and careers; Ask AI and visit tracking.
// Shared basics come from backend-core.
export async function buildApp(config: Config, deps: AppDeps & { ai?: { client: AiClient; model: string } } = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(catalogRoutes, { prefix: "/v1" });
  await app.register(engageRoutes, { prefix: "/v1" });
  await app.register(postingRoutes, { prefix: "/v1" });
  await app.register(boardRoutes, { prefix: "/v1" });
  await app.register(contentRoutes, { prefix: "/v1" });
  await app.register(insightRoutes, { prefix: "/v1", ai: deps.ai });
  await app.register(mediaRoutes);
  return app;
}
