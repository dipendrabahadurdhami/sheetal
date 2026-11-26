// GET /v1/public/catalog and /v1/public/packs: the marketplace's apps (and the software packs), editions, prices (VAT included) and free limits, for the website's Apps and Pricing pages
// (P3-FE-5) and anyone who asks. No sign-in.
// Where it fits: reads the platform.catalog setting (platform/src/billing/catalog.ts) through the typed settings store and answers with
// publicCatalog(): public fields only.
// Rules: read-only; cached by the settings store (30 s) and by browsers for 5 minutes; never any company, partner, tax or internal detail.

import type { FastifyInstance } from "fastify";
import { dbOf } from "@sheetal/platform/db/client";
import { SettingsService } from "@sheetal/platform/settings/service";
import { CATALOG_SETTING, publicCatalog, withNewApps } from "@sheetal/platform/billing/catalog";
import { publicPacks } from "@sheetal/platform/billing/packs";

export async function appCatalogRoutes(app: FastifyInstance) {
  let store: SettingsService | null = null;
  app.get("/public/catalog", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (_request, reply) => {
    store ??= new SettingsService(dbOf(app) as never, app.log);
    const cat = withNewApps(await store.get(CATALOG_SETTING));
    reply.header("cache-control", "public, max-age=300");
    return { data: publicCatalog(cat) };
  });

  // GET /v1/public/packs: the Sheetal Technology packs (Starter, Business, Pro) with their software, prices and offer, for the
  // technology landing page. Same rules: public fields only, cached 5 minutes.
  app.get("/public/packs", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (_request, reply) => {
    store ??= new SettingsService(dbOf(app) as never, app.log);
    const cat = withNewApps(await store.get(CATALOG_SETTING));
    reply.header("cache-control", "public, max-age=300");
    return { data: publicPacks(cat) };
  });
}
