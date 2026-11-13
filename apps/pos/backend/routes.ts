// Point of sale and stock (Business → Point of sale, Business → Stock), on the kernel since P2-W4.
// Where it fits: business/backend/src/app.ts registers posRoutes with { prefix: "/v1", contextOf: businessContextOf }. The old modules/pos and modules/stock
// route files are shims. The daily low-stock job is jobs.ts (registered by business/backend/src/jobs.ts).
// How it works: the context is capped at "branch" (PHASE_ONE_CAPS), so people keep today's view.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { capContext } from "@sheetal/platform/core/scope-cap";
import { PosController, StockController } from "./controllers.js";
import { PosService } from "./pos.service.js";
import { StockService } from "./stock.service.js";

export interface PosRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext> }

export async function posRoutes(app: FastifyInstance, opts: PosRoutesOptions) {
  const bus = busOf(app, "pos");
  const contextOf = async (req: FastifyRequest) => capContext(await opts.contextOf(req), "pos");
  new PosController(new PosService({ bus }), contextOf).register(app);
  new StockController(new StockService({ bus }), contextOf).register(app);
}
