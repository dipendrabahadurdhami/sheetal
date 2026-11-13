// The HTTP side of the online travel sites, exactly as the Channels page and "Other sites" call them: GET /ota/feeds, POST /ota/feeds,
// POST /ota/feeds/:id/sync; GET /ical/:tenant/:type/:sig (public, signed link); GET /ota/requests, POST /ota/requests (201),
// POST /ota/requests/:id/reply (40 MB), POST /ota/requests/:id/pause.
// Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { OtaService } from "./ota.service.js";

type P = { Params: { id: string } };

export class OtaController extends BaseController<never, never, never> {
  constructor(private readonly s: OtaService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/ota", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/ota/feeds", async (req) => ({ data: await s.feeds(await ctx(req)) }));
    app.post("/ota/feeds", async (req) => s.addFeed(await ctx(req), req.body));
    app.post<P>("/ota/feeds/:id/sync", async (req) => s.syncNow(await ctx(req), req.params.id));
    app.get<{ Params: { tenant: string; type: string; sig: string } }>("/ical/:tenant/:type/:sig", async (req, reply) =>
      reply.header("content-type", "text/calendar; charset=utf-8").header("cache-control", "no-cache").send(await s.ical(req.params.tenant, req.params.type, req.params.sig)));
    app.get("/ota/requests", async (req) => s.requests(await ctx(req), req.query));
    app.post("/ota/requests", async (req, reply) => { const r = await s.ask(await ctx(req), req.body); return reply.code(r.status).send(r.body); });
    app.post<P>("/ota/requests/:id/reply", { bodyLimit: 40_000_000 }, async (req) => s.answer(await ctx(req), req.params.id, req.body));
    app.post<P>("/ota/requests/:id/pause", async (req) => s.stop(await ctx(req), req.params.id));
  }
}
