// The HTTP side of hotels and hosts: the routes exactly as the Front desk, Bookings and Calendar pages call them, with the same answers.
// Where it fits: hotelRoutes() (routes.ts) registers this controller. GET /rooms, POST /rooms, PATCH /rooms/:id, GET /availability; GET /calendar,
// PUT /calendar/days, /calendar/rules; GET /bookings, /bookings/:id, POST /bookings, PATCH /bookings/:id; POST /bookings/:id/check-in, /folio, /payments,
// /check-out. Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { HotelService } from "./hotel.service.js";

type P = { Params: { id: string } };

export class HotelController extends BaseController<never, never, never> {
  constructor(private readonly s: HotelService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) { super(s as never, { basePath: "/bookings", standardRoutes: [], contextOf }); }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/rooms", async (req) => ({ data: await s.roomList(await ctx(req)) }));
    app.post("/rooms", async (req) => s.addRooms(await ctx(req), req.body));
    app.patch<P>("/rooms/:id", async (req) => s.editRoom(await ctx(req), req.params.id, req.body));
    app.get("/availability", async (req) => ({ data: await s.availability(await ctx(req), req.query) }));
    app.get("/calendar", async (req) => ({ data: await s.calendarMonth(await ctx(req), req.query) }));
    app.put("/calendar/days", async (req) => s.setDays(await ctx(req), req.body));
    app.put("/calendar/rules", async (req) => s.setRules(await ctx(req), req.body));
    app.get("/bookings", async (req) => ({ data: await s.bookingList(await ctx(req), req.query) }));
    app.get<P>("/bookings/:id", async (req) => ({ data: await s.one(await ctx(req), req.params.id) }));
    app.post("/bookings", async (req) => s.book(await ctx(req), req.body));
    app.patch<P>("/bookings/:id", async (req) => s.edit(await ctx(req), req.params.id, req.body));
    app.post<P>("/bookings/:id/check-in", async (req) => s.checkIn(await ctx(req), req.params.id, req.body));
    app.post<P>("/bookings/:id/folio", async (req) => s.charge(await ctx(req), req.params.id, req.body));
    app.post<P>("/bookings/:id/payments", async (req) => s.pay(await ctx(req), req.params.id, req.body));
    app.post<P>("/bookings/:id/check-out", async (req) => s.checkOut(await ctx(req), req.params.id));
  }
}
