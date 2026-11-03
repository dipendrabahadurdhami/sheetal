import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Booking, FolioLine, GuestPayment, Prisma, Room } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { dayOf, hotelBill, nightsBetween, ymd } from "@sheetal/backend-core/domain/money";
import { nightsOf, quoteStay } from "@sheetal/backend-core/domain/rates";
import { branchFor, branchView, inView, workspaceOf, type Workspace } from "../access.js";

// Hotels and hosts: rooms, availability, bookings, the front desk (check-in with the guest's ID, the room bill,
// payments, check-out once settled). A room can't be booked twice for the same night.

const ACTIVE = ["requested", "confirmed", "checked_in"];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-20.");
const METHODS = ["cash", "fonepay", "card", "esewa", "khalti", "bank"] as const;
type Full = Booking & { room: Room | null; folio: FolioLine[]; payments: GuestPayment[]; branch?: { name: string } | null };

export const bookingCode = (b: Pick<Booking, "seq">) => `BK-${String(b.seq).padStart(4, "0")}`;
/** The room bill: folio lines (service charge and VAT on top), what was paid, and what is left. */
export function folioOf(b: Pick<Full, "folio" | "payments">) {
  const charges = b.folio.filter((l) => l.kind !== "discount").reduce((s, l) => s + l.amount, 0);
  const discount = -b.folio.filter((l) => l.kind === "discount").reduce((s, l) => s + l.amount, 0);
  const bill = hotelBill(charges, discount);
  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
  return { ...bill, paid, due: bill.total - paid };
}

export async function hotelRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const need = (ws: Workspace, ...perms: string[]) => { if (!perms.some(ws.can)) throw forbidden("Your role can't do this."); };
  // Rooms and bookings belong to a branch: people see the branches in view (see access.ts), and each branch's rooms
  // are booked on their own (a Deluxe free at one branch doesn't make one free at another).
  const view = (ws: Workspace, request: FastifyRequest) => branchView(db(), request, ws);
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action, target, ip } });

  /** Rooms taken at a branch on at least one of the nights [from, to), other than `except`. */
  async function takenRooms(tenantId: string, branchId: string, from: Date, to: Date, except?: string) {
    return db().booking.findMany({ where: { tenantId, branchId, status: { in: ACTIVE }, checkIn: { lt: to }, checkOut: { gt: from }, ...(except ? { id: { not: except } } : {}) }, select: { roomId: true, roomType: true, checkIn: true, checkOut: true } });
  }
  /** Most rooms of a type taken on any single night in [from, to). */
  const peak = (taken: { roomType: string; checkIn: Date; checkOut: Date }[], type: string, from: Date, to: Date) => {
    let most = 0;
    for (let d = from.getTime(); d < to.getTime(); d += 864e5) most = Math.max(most, taken.filter((t) => t.roomType === type && t.checkIn.getTime() <= d && t.checkOut.getTime() > d).length);
    return most;
  };
  async function checkFree(tenantId: string, branchId: string, type: string, roomId: string | null, from: Date, to: Date, except?: string) {
    const taken = await takenRooms(tenantId, branchId, from, to, except);
    if (roomId && taken.some((t) => t.roomId === roomId)) throw conflict("That room is already booked for some of those nights.");
    const rooms = await db().room.count({ where: { tenantId, branchId, type, active: true } });
    if (peak(taken, type, from, to) >= rooms) throw conflict(`No ${type} room is free for all of those nights.`);
  }
  async function full(ws: Workspace, request: FastifyRequest, id: string) {
    const b = await db().booking.findFirst({ where: { id, tenantId: ws.tenantId, ...inView(await view(ws, request)) }, include: { branch: { select: { name: true } }, room: true, folio: { orderBy: { createdAt: "asc" } }, payments: { orderBy: { createdAt: "asc" } } } });
    if (!b) throw notFound("Booking not found.");
    return b;
  }
  const json = (b: Full) => ({
    id: b.id, code: bookingCode(b), status: b.status, source: b.source, guest: b.guestName, phone: b.phone, email: b.email, adults: b.adults, children: b.children,
    from: ymd(b.checkIn), to: ymd(b.checkOut), nights: nightsBetween(b.checkIn, b.checkOut), rate: b.rate, amount: b.rate * nightsBetween(b.checkIn, b.checkOut),
    type: b.roomType, roomId: b.roomId, room: b.room?.no ?? null, idChecked: b.idChecked, notes: b.notes, branchId: b.branchId, branch: b.branch?.name ?? null,
    folio: b.folio.map((l) => ({ id: l.id, kind: l.kind, what: l.what, qty: l.qty, amount: l.amount, at: l.createdAt })),
    payments: b.payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount, ref: p.ref, at: p.createdAt })), bill: folioOf(b),
  });

  // ───── Rooms ─────
  app.get("/rooms", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "bookings.view", "calendar.view", "pos.frontdesk", "settings.business");
    const today = dayOf(ymd(new Date()));
    const v = await view(ws, request);
    const [rooms, current] = await Promise.all([
      db().room.findMany({ where: { tenantId: ws.tenantId, ...inView(v) }, include: { branch: { select: { name: true } } }, orderBy: [{ type: "asc" }, { no: "asc" }] }),
      db().booking.findMany({ where: { tenantId: ws.tenantId, ...inView(v), roomId: { not: null }, OR: [{ status: "checked_in" }, { status: "confirmed", checkIn: today }] }, include: { room: true, folio: true, payments: true } }),
    ]);
    return {
      data: rooms.map((r) => {
        const b = current.find((x) => x.roomId === r.id && x.status === "checked_in") ?? current.find((x) => x.roomId === r.id);
        return { id: r.id, no: r.no, type: r.type, rate: r.rate, maxGuests: r.maxGuests, floor: r.floor, branchId: r.branchId, branch: r.branch?.name ?? null, active: r.active,
          status: b?.status === "checked_in" ? "occupied" : b ? "arriving" : r.status, guest: b?.guestName ?? null, bookingId: b?.id ?? null, idOk: b?.idChecked ?? false, bill: b ? folioOf(b) : null };
      }),
    };
  });

  app.post("/rooms", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "settings.business", "calendar.edit");
    const b = z.object({ type: z.string().trim().min(2).max(60), rate: z.number().int().min(0).max(10_000_000), nos: z.array(z.string().trim().min(1).max(20)).min(1).max(200), maxGuests: z.number().int().min(1).max(60).default(2), floor: z.string().max(20).optional(), branchId: z.string().max(40).optional(), listingId: z.number().int().optional() }).parse(request.body);
    const branchId = branchFor(await view(ws, request), b.branchId);
    const t = ws.member.tenant;
    const cap = (t.plan.limits as Record<string, number>)[t.type === "host" ? "units" : "rooms"];
    const count = await db().room.count({ where: { tenantId: ws.tenantId, active: true } });
    if (cap !== undefined && cap !== -1 && count + b.nos.length > cap) throw badRequest(`Your plan has room for ${cap} ${t.type === "host" ? "units" : "rooms"}. Upgrade to add more.`);
    const exists = await db().room.findMany({ where: { tenantId: ws.tenantId, no: { in: b.nos } }, select: { no: true } });
    if (exists.length) throw conflict(`Room ${exists.map((e) => e.no).join(", ")} already exists.`);
    await db().room.createMany({ data: b.nos.map((no) => ({ tenantId: ws.tenantId, no, type: b.type, rate: b.rate, maxGuests: b.maxGuests, floor: b.floor, branchId, listingId: b.listingId })) });
    await audit(ws, request.ip, "rooms.added", `${b.nos.length} × ${b.type}`);
    return { message: `${b.nos.length} ${b.type} room${b.nos.length > 1 ? "s" : ""} added.` };
  });

  app.patch<{ Params: { id: string } }>("/rooms/:id", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ rate: z.number().int().min(0).optional(), type: z.string().trim().min(2).max(60).optional(), status: z.enum(["vacant", "dirty", "blocked"]).optional(), active: z.boolean().optional() }).parse(request.body);
    // Housekeeping marks rooms clean; changing rates or types is setup.
    need(ws, ...(b.rate !== undefined || b.type || b.active !== undefined ? ["settings.business", "calendar.edit"] : ["calendar.view", "pos.frontdesk", "bookings.edit"]));
    const r = await db().room.updateMany({ where: { id: request.params.id, tenantId: ws.tenantId, ...inView(await view(ws, request)) }, data: b });
    if (!r.count) throw notFound("Room not found.");
    return { message: b.status === "vacant" ? "Room is ready." : "Saved." };
  });

  app.get("/availability", async (request) => {
    const ws = workspaceOf(request);
    const q = z.object({ from: date, to: date, branchId: z.string().max(40).optional() }).parse(request.query);
    const from = dayOf(q.from), to = dayOf(q.to);
    if (to <= from) throw badRequest("Check-out must be after check-in.");
    // Availability is per branch: the one asked for, else the branch open in the panel.
    const branchId = branchFor(await view(ws, request), q.branchId);
    const [rooms, taken] = await Promise.all([db().room.groupBy({ by: ["type"], where: { tenantId: ws.tenantId, branchId, active: true }, _count: true }), takenRooms(ws.tenantId, branchId, from, to)]);
    // Prices come from the calendar; a closed night or too short a stay leaves nothing free.
    return { data: await Promise.all(rooms.map(async (r) => {
      const booked = peak(taken, r.type, from, to);
      const q = await quoteStay(db(), { tenantId: ws.tenantId, branchId, type: r.type, from, to });
      const open = !q.closed.length && !q.tooShort;
      return { type: r.type, rooms: r._count, booked, free: open ? Math.max(0, r._count - booked) : 0, rate: q.rate, total: q.total, closed: q.closed, minNights: q.tooShort };
    })) };
  });

  // ───── Calendar: night prices, closed dates and rules per room type, at one branch ─────
  const calendarBranch = async (ws: Workspace, request: FastifyRequest, asked?: string) => branchFor(await view(ws, request), asked);
  app.get("/calendar", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "calendar.view", "calendar.edit", "bookings.view");
    const q = z.object({ type: z.string().max(60).optional(), month: z.string().regex(/^\d{4}-\d{2}$/), branchId: z.string().max(40).optional() }).parse(request.query);
    const branchId = await calendarBranch(ws, request, q.branchId);
    const types = (await db().room.groupBy({ by: ["type"], where: { tenantId: ws.tenantId, branchId, active: true }, _count: true, orderBy: { type: "asc" } })).map((t) => ({ type: t.type, rooms: t._count }));
    const type = q.type && types.some((t) => t.type === q.type) ? q.type : types[0]?.type;
    if (!type) return { data: { branchId, types, type: null, days: [] } };
    const from = dayOf(`${q.month}-01`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const [cal, taken] = await Promise.all([nightsOf(db(), { tenantId: ws.tenantId, branchId, type, from, to }), takenRooms(ws.tenantId, branchId, from, to)]);
    return {
      data: {
        branchId, types, type, base: cal.base, rooms: cal.rooms, rule: cal.rule,
        days: cal.nights.map((n) => { const t = dayOf(n.day).getTime(); const sold = taken.filter((b) => b.roomType === type && b.checkIn.getTime() <= t && b.checkOut.getTime() > t).length; return { ...n, sold, left: Math.max(0, cal.rooms - sold) }; }),
      },
    };
  });

  app.put("/calendar/days", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "calendar.edit");
    const b = z.object({
      type: z.string().trim().min(1).max(60), days: z.array(date).min(1).max(370), branchId: z.string().max(40).optional(),
      // A price for those nights (null = back to the normal price); and/or closed or open.
      rate: z.number().int().min(0).max(10_000_000).nullable().optional(), closed: z.boolean().optional(),
    }).refine((x) => x.rate !== undefined || x.closed !== undefined, "Set a price, or close or open the dates.").parse(request.body);
    const branchId = await calendarBranch(ws, request, b.branchId);
    if (!(await db().room.count({ where: { tenantId: ws.tenantId, branchId, type: b.type, active: true } }))) throw badRequest(`This branch has no ${b.type} rooms.`);
    await db().$transaction(async (tx) => {
      for (const d of [...new Set(b.days)]) {
        const day = dayOf(d);
        const key = { branchId_roomType_day: { branchId, roomType: b.type, day } };
        const cur = await tx.rateDay.findUnique({ where: key });
        const next = { rate: b.rate !== undefined ? b.rate : cur?.rate ?? null, closed: b.closed ?? cur?.closed ?? false };
        // Back to normal and open: no row needed.
        if (next.rate === null && !next.closed) { if (cur) await tx.rateDay.delete({ where: key }); continue; }
        await tx.rateDay.upsert({ where: key, create: { tenantId: ws.tenantId, branchId, roomType: b.type, day, ...next }, update: next });
      }
    });
    await audit(ws, request.ip, b.closed === true ? "calendar.closed" : b.closed === false ? "calendar.opened" : "calendar.priced", `${b.type}: ${b.days.length} night${b.days.length > 1 ? "s" : ""}${b.rate != null ? ` at Rs. ${b.rate}` : ""}`);
    const n = b.days.length;
    return { message: b.closed === true ? `${n} night${n > 1 ? "s" : ""} closed.` : b.closed === false ? `${n} night${n > 1 ? "s" : ""} open again.` : b.rate === null ? `${n} night${n > 1 ? "s" : ""} back to the normal price.` : `Price set for ${n} night${n > 1 ? "s" : ""}.` };
  });

  app.put("/calendar/rules", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "calendar.edit");
    const b = z.object({ type: z.string().trim().min(1).max(60), weekendPct: z.number().int().min(0).max(200), minNights: z.number().int().min(1).max(60), branchId: z.string().max(40).optional() }).parse(request.body);
    const branchId = await calendarBranch(ws, request, b.branchId);
    await db().roomRule.upsert({ where: { branchId_roomType: { branchId, roomType: b.type } }, create: { tenantId: ws.tenantId, branchId, roomType: b.type, weekendPct: b.weekendPct, minNights: b.minNights }, update: { weekendPct: b.weekendPct, minNights: b.minNights } });
    await audit(ws, request.ip, "calendar.rules", `${b.type}: weekend +${b.weekendPct}%, at least ${b.minNights} night${b.minNights > 1 ? "s" : ""}`);
    return { message: "Rules saved." };
  });

  // ───── Bookings ─────
  app.get("/bookings", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "bookings.view", "calendar.view");
    const q = z.object({ from: date.optional(), to: date.optional() }).parse(request.query);
    const where: Prisma.BookingWhereInput = { tenantId: ws.tenantId, ...inView(await view(ws, request)), ...(q.from && q.to ? { checkIn: { lt: dayOf(q.to) }, checkOut: { gt: dayOf(q.from) } } : { checkOut: { gte: new Date(Date.now() - 60 * 864e5) } }) };
    const rows = await db().booking.findMany({ where, include: { branch: { select: { name: true } }, room: true, folio: true, payments: true }, orderBy: { checkIn: "asc" }, take: 2000 });
    return { data: rows.map(json) };
  });

  app.get<{ Params: { id: string } }>("/bookings/:id", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "bookings.view", "pos.frontdesk");
    return { data: json(await full(ws, request, request.params.id)) };
  });

  app.post("/bookings", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "bookings.create");
    const b = z.object({
      type: z.string().trim().min(1).max(60), roomId: z.string().max(40).optional(), guest: z.string().trim().min(2, "Enter the guest's name.").max(80),
      phone: z.string().trim().max(30).optional(), email: z.union([z.email(), z.literal("")]).optional(), adults: z.number().int().min(1).max(60).default(2), children: z.number().int().min(0).max(20).default(0),
      from: date, to: date, rate: z.number().int().min(0).optional(), source: z.string().max(20).default("direct"), notes: z.string().max(1000).optional(),
      branchId: z.string().max(40).optional(),
    }).parse(request.body);
    const v = await view(ws, request);
    const from = dayOf(b.from), to = dayOf(b.to);
    const nights = nightsBetween(from, to);
    if (nights < 1) throw badRequest("Check-out must be after check-in.");
    if (nights > 365) throw badRequest("A booking can be up to a year.");
    if (from < dayOf(ymd(new Date(Date.now() - 864e5)))) throw badRequest("Check-in can't be in the past.");
    const room = b.roomId ? await db().room.findFirst({ where: { id: b.roomId, tenantId: ws.tenantId, active: true, ...inView(v) } }) : null;
    if (b.roomId && !room) throw notFound("Room not found.");
    if (room && room.type !== b.type) throw badRequest(`Room ${room.no} is a ${room.type}.`);
    if (room && b.adults + b.children > room.maxGuests) throw badRequest(`Room ${room.no} takes up to ${room.maxGuests} guests.`);
    // The booking's branch: its room's, else the one asked for or open in the panel.
    const branchId = room?.branchId ?? branchFor(v, b.branchId);
    const q = await quoteStay(db(), { tenantId: ws.tenantId, branchId, type: b.type, from, to });
    if (q.closed.length) throw conflict(`${b.type} is closed on ${q.closed.join(", ")}. Open those dates in the calendar first.`);
    if (q.tooShort) throw badRequest(`${b.type} stays are at least ${q.tooShort} nights.`);
    await checkFree(ws.tenantId, branchId, b.type, room?.id ?? null, from, to);
    // The night price from the calendar (average over the stay), unless one is agreed and typed in.
    const rate = b.rate ?? q.rate;
    const created = await db().booking.create({
      data: { tenantId: ws.tenantId, branchId, roomId: room?.id, roomType: b.type, guestName: b.guest, phone: b.phone, email: b.email || null, adults: b.adults, children: b.children, checkIn: from, checkOut: to, rate, source: b.source, notes: b.notes, createdBy: ws.user.id },
      include: { branch: { select: { name: true } }, room: true, folio: true, payments: true },
    });
    await audit(ws, request.ip, "booking.created", `${bookingCode(created)} ${b.guest}`);
    return { message: `Booked ${bookingCode(created)}: ${b.guest}, ${nights} night${nights > 1 ? "s" : ""}.`, data: json(created) };
  });

  app.patch<{ Params: { id: string } }>("/bookings/:id", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ status: z.enum(["confirmed", "cancelled"]).optional(), roomId: z.string().max(40).nullable().optional(), from: date.optional(), to: date.optional(), notes: z.string().max(1000).optional() }).parse(request.body);
    need(ws, b.status === "cancelled" ? "bookings.cancel" : "bookings.edit");
    const cur = await full(ws, request, request.params.id);
    if (cur.status === "completed" || cur.status === "cancelled") throw badRequest("This booking is closed.");
    if (b.status === "cancelled" && cur.status === "checked_in") throw badRequest("The guest is in the room; check them out instead.");
    const from = b.from ? dayOf(b.from) : cur.checkIn, to = b.to ? dayOf(b.to) : cur.checkOut;
    if (nightsBetween(from, to) < 1) throw badRequest("Check-out must be after check-in.");
    const roomId = b.roomId === undefined ? cur.roomId : b.roomId;
    if (b.status !== "cancelled" && (b.from || b.to || b.roomId)) {
      if (roomId) { const r = await db().room.findFirst({ where: { id: roomId, tenantId: ws.tenantId, branchId: cur.branchId } }); if (!r || r.type !== cur.roomType) throw badRequest("Pick a room of the booked type at this branch."); }
      await checkFree(ws.tenantId, cur.branchId!, cur.roomType, roomId, from, to, cur.id);
    }
    await db().booking.update({ where: { id: cur.id }, data: { status: b.status, roomId, checkIn: from, checkOut: to, notes: b.notes } });
    await audit(ws, request.ip, `booking.${b.status ?? "updated"}`, bookingCode(cur));
    return { message: b.status === "cancelled" ? "Booking cancelled." : b.status === "confirmed" ? "Booking confirmed." : "Saved.", data: json(await full(ws, request, cur.id)) };
  });

  app.post<{ Params: { id: string } }>("/bookings/:id/check-in", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "bookings.edit", "pos.frontdesk");
    const b = z.object({ roomId: z.string().max(40).optional(), idChecked: z.literal(true, { message: "See the guest's ID (citizenship, passport or licence) before checking in." }) }).parse(request.body);
    const cur = await full(ws, request, request.params.id);
    if (cur.status !== "confirmed" && cur.status !== "requested") throw badRequest(cur.status === "checked_in" ? "Already checked in." : "This booking is closed.");
    const roomId = b.roomId ?? cur.roomId;
    if (!roomId) throw badRequest("Pick a room.");
    const room = await db().room.findFirst({ where: { id: roomId, tenantId: ws.tenantId, branchId: cur.branchId, active: true } });
    if (!room || room.type !== cur.roomType) throw badRequest("Pick a room of the booked type at this branch.");
    if (room.status === "dirty" || room.status === "blocked") throw badRequest(`Room ${room.no} isn't ready (${room.status}).`);
    await checkFree(ws.tenantId, cur.branchId!, cur.roomType, room.id, cur.checkIn, cur.checkOut, cur.id);
    const nights = nightsBetween(cur.checkIn, cur.checkOut);
    await db().$transaction([
      db().booking.update({ where: { id: cur.id }, data: { status: "checked_in", roomId: room.id, idChecked: true, checkedIn: new Date() } }),
      db().folioLine.create({ data: { bookingId: cur.id, kind: "room", what: `Room ${room.no} · ${nights} night${nights > 1 ? "s" : ""} × Rs. ${cur.rate.toLocaleString("en-IN")}`, qty: nights, amount: cur.rate * nights, byUserId: ws.user.id } }),
      db().room.update({ where: { id: room.id }, data: { status: "occupied" } }),
    ]);
    await audit(ws, request.ip, "booking.checked_in", `${bookingCode(cur)} room ${room.no}`);
    return { message: `${cur.guestName} is in room ${room.no}.`, data: json(await full(ws, request, cur.id)) };
  });

  app.post<{ Params: { id: string } }>("/bookings/:id/folio", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ kind: z.enum(["extra", "discount"]), what: z.string().trim().min(2).max(120), amount: z.number().int().min(1).max(10_000_000) }).parse(request.body);
    need(ws, ...(b.kind === "discount" ? ["pos.discount"] : ["pos.frontdesk", "pos.extras", "bookings.edit"]));
    const cur = await full(ws, request, request.params.id);
    if (cur.status !== "checked_in") throw badRequest("Charges go on a room while the guest is in.");
    await db().folioLine.create({ data: { bookingId: cur.id, kind: b.kind, what: b.what, amount: b.kind === "discount" ? -b.amount : b.amount, byUserId: ws.user.id } });
    if (b.kind === "discount") await audit(ws, request.ip, "booking.discount", `${bookingCode(cur)} Rs. ${b.amount}: ${b.what}`);
    return { message: b.kind === "discount" ? "Discount added." : "Added to the room bill.", data: json(await full(ws, request, cur.id)) };
  });

  app.post<{ Params: { id: string } }>("/bookings/:id/payments", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "pos.frontdesk", "bookings.edit");
    const b = z.object({ method: z.enum(METHODS), amount: z.number().int().min(1).max(100_000_000), ref: z.string().trim().max(80).optional() }).parse(request.body);
    const cur = await full(ws, request, request.params.id);
    if (cur.status === "cancelled" || cur.status === "completed") throw badRequest("This booking is closed.");
    await db().guestPayment.create({ data: { bookingId: cur.id, method: b.method, amount: b.amount, ref: b.ref, byUserId: ws.user.id } });
    return { message: `Rs. ${b.amount.toLocaleString("en-IN")} received.`, data: json(await full(ws, request, cur.id)) };
  });

  app.post<{ Params: { id: string } }>("/bookings/:id/check-out", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "bookings.edit", "pos.frontdesk");
    const cur = await full(ws, request, request.params.id);
    if (cur.status !== "checked_in") throw badRequest("The guest isn't checked in.");
    const bill = folioOf(cur);
    if (bill.due > 0) throw badRequest(`Rs. ${bill.due.toLocaleString("en-IN")} is still to pay. Take the payment first.`);
    await db().$transaction([
      db().booking.update({ where: { id: cur.id }, data: { status: "completed", checkedOut: new Date() } }),
      ...(cur.roomId ? [db().room.update({ where: { id: cur.roomId }, data: { status: "dirty" } })] : []),
    ]);
    await audit(ws, request.ip, "booking.checked_out", bookingCode(cur));
    return { message: `${cur.guestName} checked out. Room ${cur.room?.no ?? ""} goes to housekeeping.`, data: json(await full(ws, request, cur.id)) };
  });
}
