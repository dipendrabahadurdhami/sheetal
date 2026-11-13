// The HTTP side of Projects: the routes exactly as the Projects and Collections pages call them, with the same answers.
// Where it fits: projectRoutes() (routes.ts) registers this controller. GET /projects, POST /projects/:id/units, PATCH /units/:id, POST /units/:id/hold,
// GET /reservations, POST /units/:id/reserve, POST /reservations/:id/collections, POST /reservations/:id/cancel.
// Rules: no business logic and no Prisma here. A route does nothing until app.ts registers projectRoutes.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { ProjectService } from "./project.service.js";
import type { UnitRow } from "./types.js";

type P = { Params: { id: string } };

export class ProjectController extends BaseController<UnitRow, never, Partial<UnitRow>> {
  constructor(private readonly s: ProjectService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s, { basePath: "/units", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/projects", async (req) => ({ data: await s.projects(await ctx(req)) }));
    app.post<P>("/projects/:id/units", async (req) => s.addUnits(await ctx(req), Number(req.params.id) || -1, req.body));
    app.patch<P>("/units/:id", async (req) => s.editUnit(await ctx(req), req.params.id, req.body));
    app.post<P>("/units/:id/hold", async (req) => s.hold(await ctx(req), req.params.id, req.body));
    app.get("/reservations", async (req) => ({ data: await s.reservationList(await ctx(req)) }));
    app.post<P>("/units/:id/reserve", async (req) => s.reserve(await ctx(req), req.params.id, req.body));
    app.post<P>("/reservations/:id/collections", async (req) => s.pay(await ctx(req), req.params.id, req.body));
    app.post<P>("/reservations/:id/cancel", async (req) => s.cancel(await ctx(req), req.params.id, req.body));
  }
}
