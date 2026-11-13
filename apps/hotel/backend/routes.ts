// Hotels and hosts (Business → Front desk, Bookings, Calendar), on the kernel since P2-W4.
// Where it fits: business/backend/src/app.ts registers hotelRoutes with { prefix: "/v1", contextOf: businessContextOf }; the old route file is a shim.
// Since P2-W6 also the online travel sites (calendar feeds, the public iCal link, requests to sell on other sites: ota.*). Split by job: repositories.ts,
// hotel.service.ts, hotel.controller.ts, presenter.ts, ota.repository.ts, ota.service.ts, ota.controller.ts.
// How it works: the context is capped at "branch" (PHASE_ONE_CAPS), so people keep today's view.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { capContext } from "@sheetal/platform/core/scope-cap";
import { HotelController } from "./hotel.controller.js";
import { HotelService } from "./hotel.service.js";
import { OtaController } from "./ota.controller.js";
import { OtaService } from "./ota.service.js";
import { savePrivateFile } from "@sheetal/backend-core/lib/files";
import type { Fetch } from "@sheetal/backend-core/lib/payments";

export interface HotelRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext>; /** Reads other sites' calendars (tests swap it). */ fetch?: Fetch }

export async function hotelRoutes(app: FastifyInstance, opts: HotelRoutesOptions) {
  const host = app as FastifyInstance & { db?: unknown; config: { SECRETS_KEY?: string; API_URL: string; MEDIA_DIR: string } };
  const ctxOf = async (req: FastifyRequest) => capContext(await opts.contextOf(req), "hotel");
  new HotelController(new HotelService({ bus: busOf(app, "hotel") }), ctxOf).register(app);
  new OtaController(new OtaService({
    bus: busOf(app, "hotel"), db: host.db, secretsKey: host.config.SECRETS_KEY, apiUrl: host.config.API_URL, fetch: opts.fetch,
    saveFile: (data) => savePrivateFile(host.config.MEDIA_DIR, "ota", data),
  }), ctxOf).register(app);
}
