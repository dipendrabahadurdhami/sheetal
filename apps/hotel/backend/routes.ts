// Hotels and hosts (Business → Front desk, Bookings, Calendar), on the kernel since P2-W4.
// Where it fits: business/backend/src/app.ts registers hotelRoutes with { prefix: "/v1", contextOf: businessContextOf }; the old route file is a shim.
// The online travel sites (business/backend/src/modules/ota) are not moved yet. Split by job: repositories.ts, hotel.service.ts, hotel.controller.ts, presenter.ts.
// How it works: the context is capped at "branch" (PHASE_ONE_CAPS), so people keep today's view.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { capContext } from "@sheetal/platform/core/scope-cap";
import { HotelController } from "./hotel.controller.js";
import { HotelService } from "./hotel.service.js";

export interface HotelRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext> }

export async function hotelRoutes(app: FastifyInstance, opts: HotelRoutesOptions) {
  new HotelController(new HotelService({ bus: busOf(app, "hotel") }), async (req) => capContext(await opts.contextOf(req), "hotel")).register(app);
}
