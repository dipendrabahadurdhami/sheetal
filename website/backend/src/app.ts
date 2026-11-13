// Website API (port 4000): everything the public website needs.
// Where it fits: server.ts starts it; tests build it with buildApp(); the website front-end calls it under /v1.
// How it works: the shared base app (backend-core) plus the website's modules: accounts, catalogue and search,
// enquiries and reviews, posting listings, the requirement board, blog and careers, Ask AI, visit tracking, pay rent, online forms, signing agreements and counting boosted listings, home page banners and the public site settings (/site).
// Rules: public endpoints only return public data; anything personal needs a signed-in person.

import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/platform/core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";
import { authRoutes } from "./modules/auth/routes.js";
import { registerDemoGuard } from "@sheetal/platform/demo/guard";
import { catalogRoutes, mediaRoutes } from "./modules/catalog/routes.js";
import { catalogOptionRoutes } from "./modules/catalog/options.js";
import { appCatalogRoutes } from "./modules/catalog/apps.js";
import { engageRoutes } from "./modules/engage/routes.js";
import { postingRoutes } from "./modules/posting/routes.js";
import { contentRoutes } from "./modules/content/routes.js";
import { boardRoutes } from "./modules/board/routes.js";
import { insightRoutes } from "./modules/insight/routes.js";
import { rentRoutes } from "./modules/rent/routes.js";
import { formRoutes } from "./modules/forms/routes.js";
import { signRoutes } from "./modules/sign/routes.js";
import { promoteRoutes } from "./modules/promote/routes.js";
import { bannerRoutes } from "./modules/banners/routes.js";
import { siteRoutes } from "./modules/site/routes.js";
import { publicApiRoutes } from "./modules/public/routes.js";
import type { AiClient } from "@sheetal/backend-core/lib/ai";
import type { Fetch } from "@sheetal/backend-core/lib/payments";

export async function buildApp(config: Config, deps: AppDeps & { ai?: { client: AiClient; model: string }; fetch?: Fetch } = {}): Promise<FastifyInstance> {
  const app = await buildBaseApp(config, deps);
  // A "Try the demo" visitor (platform/src/demo/guard.ts) can read the website like anyone, but can change nothing here except signing out:
  // no listing, enquiry, review or payment ever comes from a demo user.
  registerDemoGuard(app, { allow: [/^\/v1(\/auth)?\/logout$/] });
  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(catalogRoutes, { prefix: "/v1" });
  await app.register(catalogOptionRoutes, { prefix: "/v1" });
  // Phase 3 (P3-BE-1): the marketplace catalog, public.
  await app.register(appCatalogRoutes, { prefix: "/v1" });
  await app.register(engageRoutes, { prefix: "/v1" });
  await app.register(postingRoutes, { prefix: "/v1" });
  await app.register(boardRoutes, { prefix: "/v1" });
  await app.register(contentRoutes, { prefix: "/v1" });
  await app.register(insightRoutes, { prefix: "/v1", ai: deps.ai });
  await app.register(rentRoutes, { prefix: "/v1" });
  await app.register(formRoutes, { prefix: "/v1", fetch: deps.fetch });
  await app.register(signRoutes, { prefix: "/v1" });
  await app.register(promoteRoutes, { prefix: "/v1" });
  await app.register(bannerRoutes, { prefix: "/v1" });
  await app.register(siteRoutes, { prefix: "/v1" });
  await app.register(publicApiRoutes, { prefix: "/v1" });
  await app.register(mediaRoutes);
  return app;
}
