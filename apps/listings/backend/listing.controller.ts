// The HTTP side of a business's listings, exactly as the Listings page, the wizard and the check-ups page call it: GET /listings, /listings/:code;
// POST /listing-photos (28 MB, 120 an hour), POST /listings (60 an hour), PATCH /listings/:code, POST /listings/status, /listings/:code/duplicate,
// /listings/delete; GET /listings/:code/move-targets, POST /listings/:code/move. Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { ListingService } from "./listing.service.js";

type P = { Params: { code: string } };

export class ListingController extends BaseController<never, never, never> {
  constructor(private readonly s: ListingService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) { super(s as never, { basePath: "/listings", standardRoutes: [], contextOf }); }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/listings", async (req) => s.browse(await ctx(req), req.query));
    app.get<P>("/listings/:code", async (req) => ({ data: await s.one(await ctx(req), req.params.code) }));
    app.post("/listing-photos", { bodyLimit: 28 * 1024 * 1024, config: { rateLimit: { max: 120, timeWindow: "1 hour" } } }, async (req) => ({ data: await s.photo(await ctx(req), req.body) }));
    app.post("/listings", { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (req) => s.add(await ctx(req), req.body));
    app.patch<P>("/listings/:code", async (req) => s.edit(await ctx(req), req.params.code, req.body));
    app.post("/listings/status", async (req) => s.setStatus(await ctx(req), req.body));
    app.post<P>("/listings/:code/duplicate", async (req) => s.duplicate(await ctx(req), req.params.code));
    app.post("/listings/delete", async (req) => s.removeMany(await ctx(req), req.body));
    app.get<P>("/listings/:code/move-targets", async (req) => ({ data: await s.moveTargets(await ctx(req), req.params.code) }));
    app.post<P>("/listings/:code/move", async (req) => s.move(await ctx(req), req.params.code, req.body));
  }
}
