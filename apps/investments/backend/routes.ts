// Investments (sponsors): offerings, investor pledges and updates, on the kernel since P2-W3 (split out of business/backend/src/modules/projects/routes.ts).
// Where it fits: business/backend/src/app.ts registers investmentRoutes with { prefix: "/v1", contextOf: businessContextOf }. The mailer is the API's.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { capContext } from "@sheetal/platform/core/scope-cap";
import { InvestmentController } from "./investment.controller.js";
import { InvestmentService, type Mailer } from "./investment.service.js";

export interface InvestmentRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext> }

export async function investmentRoutes(app: FastifyInstance, opts: InvestmentRoutesOptions) {
  const host = app as FastifyInstance & { mailer?: Mailer };
  const service = new InvestmentService({ bus: busOf(app, "investments"), mailer: () => { if (!host.mailer) throw new Error("The investments app needs the mailer (app.mailer)."); return host.mailer; } });
  new InvestmentController(service, async (req) => capContext(await opts.contextOf(req), "investments")).register(app);
}
