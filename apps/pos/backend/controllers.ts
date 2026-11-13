// The HTTP side of the point of sale and stock: the routes exactly as the POS and Stock pages call them, with the same answers.
// Where it fits: posRoutes() (routes.ts) registers both controllers.
// POS: GET /menu, POST /menu, PATCH /menu/:id; GET /shifts/current, POST /shifts/open, /shifts/close; GET /pos/bills, POST /pos/bills, /pos/bills/:id/void.
// Stock: GET /stock, POST /stock, PATCH /stock/:id; POST /stock/:id/in, /out, /count; GET /stock/moves, /stock/export, POST /stock/import;
// GET /stock/recipes, PUT /stock/recipes/:menuItemId; GET /stock/low.
// Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { PosService } from "./pos.service.js";
import type { StockService } from "./stock.service.js";

type ContextOf = (req: FastifyRequest) => Promise<BusinessContext>;
type P = { Params: { id: string } };

export class PosController extends BaseController<never, never, never> {
  constructor(private readonly s: PosService, contextOf: ContextOf) { super(s as never, { basePath: "/pos/bills", standardRoutes: [], contextOf }); }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/menu", async (req) => ({ data: await s.menuList(await ctx(req)) }));
    app.post("/menu", async (req) => s.menuAdd(await ctx(req), req.body));
    app.patch<P>("/menu/:id", async (req) => s.menuEdit(await ctx(req), req.params.id, req.body));
    app.get("/shifts/current", async (req) => ({ data: await s.currentShift(await ctx(req)) }));
    app.post("/shifts/open", async (req) => s.openShift(await ctx(req), req.body));
    app.post("/shifts/close", async (req) => s.closeShift(await ctx(req), req.body));
    app.get("/pos/bills", async (req) => ({ data: await s.billList(await ctx(req), req.query) }));
    app.post("/pos/bills", async (req) => s.ring(await ctx(req), req.body));
    app.post<P>("/pos/bills/:id/void", async (req) => s.voidBill(await ctx(req), req.params.id, req.body));
  }
}

export class StockController extends BaseController<never, never, never> {
  constructor(private readonly s: StockService, contextOf: ContextOf) { super(s as never, { basePath: "/stock", standardRoutes: [], contextOf }); }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/stock", async (req) => ({ data: await s.overview(await ctx(req), req.query) }));
    app.post("/stock", async (req) => s.add(await ctx(req), req.body));
    app.patch<P>("/stock/:id", async (req) => s.edit(await ctx(req), req.params.id, req.body));
    app.post<P>("/stock/:id/in", async (req) => s.stockIn(await ctx(req), req.params.id, req.body));
    app.post<P>("/stock/:id/out", async (req) => s.stockOut(await ctx(req), req.params.id, req.body));
    app.post<P>("/stock/:id/count", async (req) => s.count(await ctx(req), req.params.id, req.body));
    app.get("/stock/moves", async (req) => ({ data: await s.history(await ctx(req), req.query) }));
    app.get("/stock/export", async (req, reply) => {
      const f = await s.csv(await ctx(req));
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${f.name}"`).send(f.body);
    });
    app.post("/stock/import", async (req) => s.importRows(await ctx(req), req.body));
    app.get("/stock/recipes", async (req) => ({ data: await s.recipes(await ctx(req)) }));
    app.put<{ Params: { menuItemId: string } }>("/stock/recipes/:menuItemId", async (req) => s.setRecipe(await ctx(req), req.params.menuItemId, req.body));
    app.get("/stock/low", async (req) => ({ data: await s.low(await ctx(req)) }));
  }
}
