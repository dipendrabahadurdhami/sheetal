// The HTTP side of People: the routes exactly as the page (LivePeople.jsx) calls them, with the same answers.
// Where it fits: peopleRoutes() (routes.ts) registers this controller; each handler builds the context, calls ONE service method and shapes the answer.
// How it works: GET /people/me, /board, /leave-types, /leave, /summary, /settings; POST /people/check-in, /check-out, /attendance, /leave-types, /leave,
// /leave/:id/cancel, /leave/:id/decide; PATCH /people/attendance/:id, /leave-types/:id; PUT /people/settings. Rows now also carry `version`.
// Rules: no business logic and no Prisma here. The standard routes of BaseController are off. A route does nothing until app.ts registers peopleRoutes.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { PeopleService } from "./people.service.js";
import { IdParam } from "./schemas.js";
import type { AttendanceRow } from "./types.js";

type ContextOf = (req: FastifyRequest) => Promise<BusinessContext>;

export class PeopleController extends BaseController<AttendanceRow, Partial<AttendanceRow>, Partial<AttendanceRow>> {
  constructor(private readonly people: PeopleService, contextOf: ContextOf) {
    super(people, { basePath: "/people", standardRoutes: [], contextOf, createStatus: 201, updateMethod: "PATCH" });
  }

  protected override routes(app: FastifyInstance): void {
    const s = this.people;
    const id = (req: FastifyRequest) => IdParam.parse(req.params).id;
    const ctx = (req: FastifyRequest) => this.ctxOf(req);

    app.get("/people/me", async (req) => ({ data: await s.me(await ctx(req)) }));
    app.post("/people/check-in", async (req) => ({ status: 200, ...(await s.checkIn(await ctx(req), req.body)) }));
    app.post("/people/check-out", async (req) => ({ status: 200, ...(await s.checkOut(await ctx(req), req.body)) }));
    app.get("/people/board", async (req) => ({ data: await s.board(await ctx(req), req.query) }));
    app.post("/people/attendance", async (req) => ({ status: 201, message: "Record added.", data: await s.addRecord(await ctx(req), req.body) }));
    app.patch("/people/attendance/:id", async (req) => { await s.fixRecord(await ctx(req), id(req), req.body); return { status: 200, message: "Record fixed." }; });
    app.get("/people/leave-types", async (req) => ({ data: await s.leaveTypes(await ctx(req)) }));
    app.post("/people/leave-types", async (req) => ({ status: 201, message: "Leave type added.", data: await s.addType(await ctx(req), req.body) }));
    app.patch("/people/leave-types/:id", async (req) => { await s.editType(await ctx(req), id(req), req.body); return { status: 200, message: "Saved." }; });
    app.get("/people/leave", async (req) => ({ data: await s.leaveList(await ctx(req), req.query) }));
    app.post("/people/leave", async (req) => ({ status: 201, message: "Leave requested.", data: await s.askLeave(await ctx(req), req.body) }));
    app.post("/people/leave/:id/cancel", async (req) => { await s.cancelLeave(await ctx(req), id(req)); return { status: 200, message: "Leave cancelled." }; });
    app.post("/people/leave/:id/decide", async (req) => ({ status: 200, ...(await s.decide(await ctx(req), id(req), req.body)) }));
    app.get("/people/summary", async (req) => ({ data: await s.summary(await ctx(req), req.query) }));
    app.get("/people/settings", async (req) => ({ data: { workStart: await s.workStart(await ctx(req)) } }));
    app.put("/people/settings", async (req) => { await s.saveSettings(await ctx(req), req.body); return { status: 200, message: "Saved." }; });
  }
}
