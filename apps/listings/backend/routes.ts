// A business's listings (Business → Listings, the wizard, check-ups), on the kernel since P2-W5.
// Where it fits: business/backend/src/app.ts registers listingRoutes with { prefix: "/v1", contextOf: businessContextOf }; the old route file is a shim.
// How it works: the context is capped at "branch" (PHASE_ONE_CAPS). Which kinds each business type may list come from Admin → Listing setup (the catalog,
// warmed once here). Photos are saved in MEDIA_DIR and served from the media address.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { capContext } from "@sheetal/platform/core/scope-cap";
import { mediaBase } from "@sheetal/backend-core/lib/photos";
import { catalogKindsNow, warmCatalog } from "@sheetal/backend-core/lib/catalog";
import { ListingController } from "./listing.controller.js";
import { ListingService } from "./listing.service.js";

export interface ListingRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext> }

export async function listingRoutes(app: FastifyInstance, opts: ListingRoutesOptions) {
  const host = app as FastifyInstance & { db?: unknown; config: { MEDIA_DIR: string } };
  if (host.db) warmCatalog(host.db as never).catch(() => {});
  const service = new ListingService({ bus: busOf(app, "listings"), mediaBase: mediaBase(host.config as never), mediaDir: host.config.MEDIA_DIR, catalog: () => catalogKindsNow(host.db as never) });
  new ListingController(service, async (req) => capContext(await opts.contextOf(req), "listings")).register(app);
}
