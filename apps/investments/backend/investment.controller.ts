// The HTTP side of Investments: GET /investments, POST /investments/:id/commitments, PATCH /commitments/:id, POST /investments/:id/updates (10 an hour),
// exactly as the Investors page calls them. Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { InvestmentService } from "./investment.service.js";
import type { CommitmentRow } from "./types.js";

type P = { Params: { id: string } };

export class InvestmentController extends BaseController<CommitmentRow, never, Partial<CommitmentRow>> {
  constructor(private readonly s: InvestmentService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s, { basePath: "/commitments", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/investments", async (req) => ({ data: await s.overview(await ctx(req)) }));
    app.post<P>("/investments/:id/commitments", async (req) => s.pledge(await ctx(req), Number(req.params.id) || -1, req.body));
    app.patch<P>("/commitments/:id", async (req) => s.mark(await ctx(req), req.params.id, req.body));
    app.post<P>("/investments/:id/updates", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => s.post(await ctx(req), Number(req.params.id) || -1, req.body));
  }
}
