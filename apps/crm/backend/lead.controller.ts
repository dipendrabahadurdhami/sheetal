// The HTTP side of the Inbox: GET /leads, PATCH /leads/:id, POST /leads/:id/reply (60 per 10 minutes), exactly as the panel calls them.
// Rules: no business logic and no Prisma here. A route does nothing until app.ts registers leadRoutes.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { LeadService } from "./lead.service.js";

type P = { Params: { id: string } };

export class LeadController extends BaseController<never, never, never> {
  constructor(private readonly s: LeadService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) { super(s as never, { basePath: "/leads", standardRoutes: [], contextOf }); }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/leads", async (req) => ({ data: await s.inbox(await ctx(req), req.query) }));
    app.patch<P>("/leads/:id", async (req) => s.edit(await ctx(req), req.params.id, req.body));
    app.post<P>("/leads/:id/reply", { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } }, async (req) => s.reply(await ctx(req), req.params.id, req.body));
  }
}
