// The HTTP side of customer invoices: the routes exactly as the Customer invoices page, the booking drawer and the import call them, with the same answers.
// Where it fits: invoicingRoutes() (routes.ts) registers this controller. GET /invoices, /invoices/rows; POST /invoices, /invoices/:id/send, /:id/receipts,
// /:id/cancel, /:id/credit, /invoices/from-booking, /invoices/import; PUT /invoices/:id; DELETE /invoices/:id.
// Rules: no business logic and no Prisma here. A route does nothing until app.ts registers invoicingRoutes.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { InvoiceService } from "./invoice.service.js";
import type { InvoiceRow } from "./types.js";

type P = { Params: { id: string } };

export class InvoiceController extends BaseController<InvoiceRow, never, never> {
  constructor(private readonly s: InvoiceService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s, { basePath: "/invoices", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/invoices", async (req) => ({ data: await s.all(await ctx(req)) }));
    app.get("/invoices/rows", async (req) => ({ data: await s.rows(await ctx(req)) }));
    app.post("/invoices", async (req) => s.make(await ctx(req), req.body));
    app.put<P>("/invoices/:id", async (req) => s.save(await ctx(req), req.params.id, req.body));
    app.post<P>("/invoices/:id/send", async (req) => s.send(await ctx(req), req.params.id));
    app.delete<P>("/invoices/:id", async (req) => s.removeDraft(await ctx(req), req.params.id));
    app.post<P>("/invoices/:id/receipts", async (req) => s.pay(await ctx(req), req.params.id, req.body));
    app.post<P>("/invoices/:id/cancel", async (req) => s.cancel(await ctx(req), req.params.id, req.body));
    app.post<P>("/invoices/:id/credit", async (req) => s.credit(await ctx(req), req.params.id, req.body));
    app.post("/invoices/from-booking", async (req) => s.fromBooking(await ctx(req), req.body));
    app.post("/invoices/import", async (req) => s.importRows(await ctx(req), req.body));
  }
}
