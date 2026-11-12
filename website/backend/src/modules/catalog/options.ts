// The listing options Sheetal staff changed in Admin → Listing setup, for the website's filters and labels.
// Where it fits: website/frontend/src/utils/listingOptions.js lays them over the built-in list.
// How it works: only the lists staff changed are sent (backend-core/src/lib/catalog.ts); cached for a minute.

import type { FastifyInstance } from "fastify";
import { cached } from "@sheetal/backend-core/lib/cache";
import { dbOf } from "@sheetal/platform/db/client";
import { readCatalog } from "@sheetal/backend-core/lib/catalog";

export async function catalogOptionRoutes(app: FastifyInstance) {
  app.get("/catalog", async () => ({ data: await cached(app.cache, "catalog:stored", 60, () => readCatalog(dbOf(app))) }));
}
