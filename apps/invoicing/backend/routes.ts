// Customer invoices, credit notes and receipts (Business → Customer invoices), on the kernel since P2-W3.
// Where it fits: business/backend/src/app.ts registers invoicingRoutes with { prefix: "/v1", contextOf: businessContextOf }; the old route file is a shim.
// Split by job: invoice.repository.ts (tables, locks, numbers), invoice.service.ts (rules), invoice.controller.ts (HTTP), presenter.ts.
// How it works: the context is capped at "branch" (PHASE_ONE_CAPS), so people keep today's view.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { capContext } from "@sheetal/platform/core/scope-cap";
import { InvoiceController } from "./invoice.controller.js";
import { InvoiceService } from "./invoice.service.js";

export interface InvoicingRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext> }

export async function invoicingRoutes(app: FastifyInstance, opts: InvoicingRoutesOptions) {
  new InvoiceController(new InvoiceService({ bus: busOf(app, "invoicing") }), async (req) => capContext(await opts.contextOf(req), "invoicing")).register(app);
}
