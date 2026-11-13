// The HTTP side of the Workspace's growth tools, exactly as the panel calls them: GET /ai/usage, GET /analytics, GET /channels, POST /channels,
// POST /channels/:id/disconnect. Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { GrowthService } from "./growth.service.js";

export class GrowthController extends BaseController<never, never, never> {
  constructor(private readonly s: GrowthService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/channels", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/ai/usage", async (req) => ({ data: await s.aiUsage(await ctx(req)) }));
    app.get("/analytics", async (req) => ({ data: await s.analytics(await ctx(req), req.query) }));
    app.get("/channels", async (req) => ({ data: await s.channels(await ctx(req)) }));
    app.post("/channels", async (req) => s.connect(await ctx(req), req.body));
    app.post<{ Params: { id: string } }>("/channels/:id/disconnect", async (req) => s.disconnect(await ctx(req), req.params.id));
  }
}
