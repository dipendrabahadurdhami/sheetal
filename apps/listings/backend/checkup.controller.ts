// The HTTP side of listing check-ups, exactly as LiveCheckups.jsx calls it: GET /checkups/setup, PUT /checkups/setup, GET /checkups/today,
// POST /checkups/review/:code, POST /checkups/decide, GET /checkups/conflicts, POST /checkups/conflicts/:code, GET /checkups/history.
// Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { CheckupService } from "./checkup.service.js";

type C = { Params: { code: string } };

export class CheckupController extends BaseController<never, never, never> {
  constructor(private readonly s: CheckupService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/checkups", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/checkups/setup", async (req) => ({ data: await s.setup(await ctx(req)) }));
    app.put("/checkups/setup", async (req) => s.saveSetup(await ctx(req), req.body));
    app.get("/checkups/today", async (req) => ({ data: await s.today(await ctx(req)) }));
    app.post<C>("/checkups/review/:code", async (req) => s.review(await ctx(req), req.params.code, req.body));
    app.post("/checkups/decide", async (req) => s.decideNow(await ctx(req)));
    app.get("/checkups/conflicts", async (req) => ({ data: await s.conflicts(await ctx(req)) }));
    app.post<C>("/checkups/conflicts/:code", async (req) => s.pick(await ctx(req), req.params.code, req.body));
    app.get("/checkups/history", async (req) => ({ data: await s.history(await ctx(req), req.query) }));
  }
}
