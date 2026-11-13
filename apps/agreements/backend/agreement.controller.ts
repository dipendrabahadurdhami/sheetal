// The HTTP side of Agreements (business panel): the routes exactly as LiveAgreements.jsx calls them, with the same answers.
// Where it fits: agreementRoutes() (routes.ts) registers this controller; each handler builds the context, calls ONE service method and shapes the answer.
// How it works: GET /agreements, /agreements/:id; POST /agreements, /:id/send, /:id/signers/:signerId/remind, /:id/cancel, /:id/copy; PUT /agreements/:id;
// DELETE /agreements/:id. Rows now also carry `version`.
// Rules: no business logic and no Prisma here. A route does nothing until app.ts registers agreementRoutes.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { AgreementService } from "./agreement.service.js";
import type { AgreementRow } from "./types.js";

type ContextOf = (req: FastifyRequest) => Promise<BusinessContext>;
type P = { Params: { id: string; signerId?: string } };

export class AgreementController extends BaseController<AgreementRow, never, never> {
  constructor(private readonly s: AgreementService, contextOf: ContextOf) {
    super(s, { basePath: "/agreements", standardRoutes: [], contextOf });
  }

  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/agreements", async (req) => ({ data: await s.overview(await ctx(req)) }));
    app.get<P>("/agreements/:id", async (req) => ({ data: await s.detail(await ctx(req), req.params.id) }));
    app.post("/agreements", async (req) => ({ status: 201, message: "Draft made. Check the details, then send it for signing.", data: await s.makeDraft(await ctx(req), req.body) }));
    app.put<P>("/agreements/:id", async (req) => ({ message: "Saved.", data: await s.save(await ctx(req), req.params.id, req.body) }));
    app.post<P>("/agreements/:id/send", async (req) => s.send(await ctx(req), req.params.id));
    app.post<P>("/agreements/:id/signers/:signerId/remind", async (req) => s.remind(await ctx(req), req.params.id, req.params.signerId ?? ""));
    app.post<P>("/agreements/:id/cancel", async (req) => s.cancel(await ctx(req), req.params.id, req.body));
    app.post<P>("/agreements/:id/copy", async (req) => ({ status: 201, message: "New draft made from it.", data: await s.copy(await ctx(req), req.params.id) }));
    app.delete<P>("/agreements/:id", async (req) => s.removeDraft(await ctx(req), req.params.id));
  }
}
