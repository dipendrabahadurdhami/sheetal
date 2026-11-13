// The rules of hotels and hosts: rooms, the calendar (night prices, closed dates, rules), availability, bookings and the front desk, on the kernel. Moved from
// business/backend/src/modules/hotel/routes.ts (P2-W4); every rule and message unchanged.
// Where it fits: HotelController calls one method per route.
// How it works: rooms and bookings belong to a branch; prices come from the calendar (backend-core domain/rates.ts); check-in needs the guest's ID seen; the
// room bill collects nights, extras and restaurant bills with service and VAT; check-out only once the bill is paid. Each change runs in ONE transaction with
// its audit line (the old strings where there was one) and its event. A booking (new, moved dates or room, check-in) re-checks that the room is free inside
// its transaction, holding the rooms of that type at that branch, so two people booking the last room at the same moment can't both win.
// Rules: a room is never booked twice for one night, nor a type beyond its rooms; closed nights and stays shorter than the minimum are refused; staff only
// touch their branches' rooms and bookings; a closed booking (checked out or cancelled) never changes.

import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BranchEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import { dayOf, nightsBetween, ymd } from "@sheetal/backend-core/domain/money";
import { nightsOf, quoteStay } from "@sheetal/backend-core/domain/rates";
import { bookingCode, bookingJson, folioOf, peak, type Full } from "./presenter.js";
import { BookingRepository, CalendarRepository, RoomRepository, db } from "./repositories.js";

const SETTINGS = "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-20.");
const METHODS = ["cash", "fonepay", "card", "esewa", "khalti", "bank"] as const;
const n = (k: number, word = "night") => `${k} ${word}${k > 1 ? "s" : ""}`;

const AddRooms = z.object({ type: z.string().trim().min(2).max(60), rate: z.number().int().min(0).max(10_000_000), nos: z.array(z.string().trim().min(1).max(20)).min(1).max(200), maxGuests: z.number().int().min(1).max(60).default(2), floor: z.string().max(20).optional(), branchId: z.string().max(40).optional(), listingId: z.number().int().optional() });
const EditRoom = z.object({ rate: z.number().int().min(0).optional(), type: z.string().trim().min(2).max(60).optional(), status: z.enum(["vacant", "dirty", "blocked"]).optional(), active: z.boolean().optional(), version: z.number().int().min(1).optional() });
const Days = z.object({ type: z.string().trim().min(1).max(60), days: z.array(date).min(1).max(370), branchId: z.string().max(40).optional(), rate: z.number().int().min(0).max(10_000_000).nullable().optional(), closed: z.boolean().optional() })
  .refine((x) => x.rate !== undefined || x.closed !== undefined, "Set a price, or close or open the dates.");
const Rules = z.object({ type: z.string().trim().min(1).max(60), weekendPct: z.number().int().min(0).max(200), minNights: z.number().int().min(1).max(60), branchId: z.string().max(40).optional() });
const NewBooking = z.object({
  type: z.string().trim().min(1).max(60), roomId: z.string().max(40).optional(), guest: z.string().trim().min(2, "Enter the guest's name.").max(80),
  phone: z.string().trim().max(30).optional(), email: z.union([z.email(), z.literal("")]).optional(), adults: z.number().int().min(1).max(60).default(2), children: z.number().int().min(0).max(20).default(0),
  from: date, to: date, rate: z.number().int().min(0).optional(), source: z.string().max(20).default("direct"), notes: z.string().max(1000).optional(), branchId: z.string().max(40).optional(),
});
const EditBooking = z.object({ status: z.enum(["confirmed", "cancelled"]).optional(), roomId: z.string().max(40).nullable().optional(), from: date.optional(), to: date.optional(), notes: z.string().max(1000).optional(), version: z.number().int().min(1).optional() });

type B = BranchEntity & { seq: number };
class BookingBase extends BaseRepository<B, never, never> {
  constructor() { super({ model: "booking", ownerField: "createdBy", label: "This booking", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
}

export class HotelService extends BaseService<B, never, never> {
  readonly rooms = new RoomRepository();
  readonly bookings = new BookingRepository();
  readonly calendar = new CalendarRepository();
  constructor(deps: { bus: EventBus }) {
    super({ app: "hotel", resource: "booking", repo: new BookingBase(), permissions: { read: "hotel.booking.read", create: "hotel.booking.create", update: "hotel.booking.update", delete: "hotel.booking.cancel" },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "booking", label: (b) => bookingCode(b) }, bus: deps.bus, requireVersion: false });
  }

  private need(ctx: BusinessContext, ...perms: string[]) { if (!perms.some((p) => ctx.permissions.can(p))) throw forbidden("Your role can't do this."); }
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => { audit?: { action: string; target: string }; event: { name: string; payload: object; branchId?: string | null } }): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      if (a.audit) await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1, { branchId: a.event.branchId ?? null });
      return r;
    });
  }
  private async full(ctx: BusinessContext, id: string): Promise<Full> {
    const b = await this.bookings.full(ctx, id);
    if (!b) throw notFound("Booking not found.");
    return b as Full;
  }
  /** Inside the transaction: holds the rooms of the type, then checks the room and the type are free for all the nights. */
  private async checkFree(tx: BusinessContext, branchId: string, type: string, roomId: string | null, from: Date, to: Date, except?: string) {
    await this.rooms.lockType(tx, branchId, type);
    const taken = await this.bookings.taken(tx, branchId, from, to, except);
    if (roomId && taken.some((t) => t.roomId === roomId)) throw conflict("That room is already booked for some of those nights.");
    if (peak(taken, type, from, to) >= (await this.rooms.countType(tx, branchId, type))) throw conflict(`No ${type} room is free for all of those nights.`);
  }

  // ───── Rooms ─────
  async roomList(ctx: BusinessContext) {
    this.need(ctx, "hotel.booking.read", "hotel.calendar.read", "pos.frontdesk.use", SETTINGS);
    const [rooms, current] = await Promise.all([this.rooms.inView(ctx), this.bookings.current(ctx, dayOf(ymd(new Date())))]);
    return rooms.map((r) => {
      const b = current.find((x) => x.roomId === r.id && x.status === "checked_in") ?? current.find((x) => x.roomId === r.id);
      return { id: r.id, no: r.no, type: r.type, rate: r.rate, maxGuests: r.maxGuests, floor: r.floor, branchId: r.branchId, branch: r.branch?.name ?? null, active: r.active,
        status: b?.status === "checked_in" ? "occupied" : b ? "arriving" : r.status, guest: b?.guestName ?? null, bookingId: b?.id ?? null, idOk: b?.idChecked ?? false, bill: b ? folioOf(b) : null, version: r.version };
    });
  }

  async addRooms(ctx: BusinessContext, raw: unknown) {
    this.need(ctx, SETTINGS, "hotel.calendar.update");
    const b = AddRooms.parse(raw);
    const branchId = ctx.branches.branchForNew(b.branchId);
    const host = ctx.business.type === "host";
    const cap = (await this.rooms.planLimits(ctx))[host ? "units" : "rooms"];
    if (cap !== undefined && cap !== -1 && (await this.rooms.countActive(ctx)) + b.nos.length > cap) throw badRequest(`Your plan has room for ${cap} ${host ? "units" : "rooms"}. Upgrade to add more.`);
    const exists = await this.rooms.numbersTaken(ctx, b.nos);
    if (exists.length) throw conflict(`Room ${exists.map((e) => e.no).join(", ")} already exists.`);
    await this.write(ctx, (tx) => this.rooms.addMany(tx, b.nos.map((no) => ({ no, type: b.type, rate: b.rate, maxGuests: b.maxGuests, floor: b.floor, branchId, listingId: b.listingId }))),
      () => ({ audit: { action: "rooms.added", target: `${b.nos.length} × ${b.type}` }, event: { name: "hotel.room.added", payload: { count: b.nos.length, type: b.type }, branchId } }));
    return { message: `${b.nos.length} ${b.type} room${b.nos.length > 1 ? "s" : ""} added.` };
  }

  async editRoom(ctx: BusinessContext, id: string, raw: unknown) {
    const { version, ...b } = EditRoom.parse(raw);
    // Housekeeping marks rooms clean; changing rates or types is setup.
    this.need(ctx, ...(b.rate !== undefined || b.type || b.active !== undefined ? [SETTINGS, "hotel.calendar.update"] : ["hotel.calendar.read", "pos.frontdesk.use", "hotel.booking.update"]));
    await this.write(ctx, async (tx) => {
      if (!(await this.rooms.change(tx, id, b, version))) {
        if (version !== undefined && (await this.rooms.exists(tx, id))) throw conflict("Someone else changed this room. Reload to see the latest.");
        throw notFound("Room not found.");
      }
      return id;
    }, () => ({ event: { name: "hotel.room.updated", payload: { id, status: b.status ?? null } } }));
    return { message: b.status === "vacant" ? "Room is ready." : "Saved." };
  }

  async availability(ctx: BusinessContext, rawQuery: unknown) {
    const q = z.object({ from: date, to: date, branchId: z.string().max(40).optional() }).parse(rawQuery);
    const from = dayOf(q.from), to = dayOf(q.to);
    if (to <= from) throw badRequest("Check-out must be after check-in.");
    // Availability is per branch: the one asked for, else the branch open in the panel.
    const branchId = ctx.branches.branchForNew(q.branchId);
    const [types, taken] = await Promise.all([this.rooms.typesAt(ctx, branchId), this.bookings.taken(ctx, branchId, from, to)]);
    // Prices come from the calendar; a closed night or too short a stay leaves nothing free.
    return Promise.all(types.map(async (r) => {
      const booked = peak(taken, r.type, from, to);
      const quote = await quoteStay(db(ctx) as never, { tenantId: ctx.business.id, branchId, type: r.type, from, to });
      const open = !quote.closed.length && !quote.tooShort;
      return { type: r.type, rooms: r._count, booked, free: open ? Math.max(0, r._count - booked) : 0, rate: quote.rate, total: quote.total, closed: quote.closed, minNights: quote.tooShort };
    }));
  }

  // ───── Calendar: night prices, closed dates and rules per room type, at one branch ─────
  async calendarMonth(ctx: BusinessContext, rawQuery: unknown) {
    this.need(ctx, "hotel.calendar.read", "hotel.calendar.update", "hotel.booking.read");
    const q = z.object({ type: z.string().max(60).optional(), month: z.string().regex(/^\d{4}-\d{2}$/), branchId: z.string().max(40).optional() }).parse(rawQuery);
    const branchId = ctx.branches.branchForNew(q.branchId);
    const types = (await this.rooms.typesAt(ctx, branchId)).map((t) => ({ type: t.type, rooms: t._count }));
    const type = q.type && types.some((t) => t.type === q.type) ? q.type : types[0]?.type;
    if (!type) return { branchId, types, type: null, days: [] };
    const from = dayOf(`${q.month}-01`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const [cal, taken] = await Promise.all([nightsOf(db(ctx) as never, { tenantId: ctx.business.id, branchId, type, from, to }), this.bookings.taken(ctx, branchId, from, to)]);
    return {
      branchId, types, type, base: cal.base, rooms: cal.rooms, rule: cal.rule,
      days: cal.nights.map((x) => { const t = dayOf(x.day).getTime(); const sold = taken.filter((b) => b.roomType === type && b.checkIn.getTime() <= t && b.checkOut.getTime() > t).length; return { ...x, sold, left: Math.max(0, cal.rooms - sold) }; }),
    };
  }

  async setDays(ctx: BusinessContext, raw: unknown) {
    this.need(ctx, "hotel.calendar.update");
    const b = Days.parse(raw);
    const branchId = ctx.branches.branchForNew(b.branchId);
    if (!(await this.rooms.countType(ctx, branchId, b.type))) throw badRequest(`This branch has no ${b.type} rooms.`);
    const k = b.days.length;
    await this.write(ctx, async (tx) => {
      for (const d of [...new Set(b.days)]) {
        const day = dayOf(d);
        const cur = await this.calendar.day(tx, branchId, b.type, day);
        const next = { rate: b.rate !== undefined ? b.rate : cur?.rate ?? null, closed: b.closed ?? cur?.closed ?? false };
        // Back to normal and open: no row needed.
        if (next.rate === null && !next.closed) { if (cur) await this.calendar.clearDay(tx, branchId, b.type, day); continue; }
        await this.calendar.setDay(tx, branchId, b.type, day, next);
      }
    }, () => ({ audit: { action: b.closed === true ? "calendar.closed" : b.closed === false ? "calendar.opened" : "calendar.priced", target: `${b.type}: ${n(k)}${b.rate != null ? ` at Rs. ${b.rate}` : ""}` }, event: { name: "hotel.calendar.changed", payload: { type: b.type, nights: k, rate: b.rate ?? null, closed: b.closed ?? null }, branchId } }));
    return { message: b.closed === true ? `${n(k)} closed.` : b.closed === false ? `${n(k)} open again.` : b.rate === null ? `${n(k)} back to the normal price.` : `Price set for ${n(k)}.` };
  }

  async setRules(ctx: BusinessContext, raw: unknown) {
    this.need(ctx, "hotel.calendar.update");
    const b = Rules.parse(raw);
    const branchId = ctx.branches.branchForNew(b.branchId);
    await this.write(ctx, (tx) => this.calendar.setRule(tx, branchId, b.type, { weekendPct: b.weekendPct, minNights: b.minNights }),
      () => ({ audit: { action: "calendar.rules", target: `${b.type}: weekend +${b.weekendPct}%, at least ${n(b.minNights)}` }, event: { name: "hotel.calendar.changed", payload: { type: b.type, weekendPct: b.weekendPct, minNights: b.minNights }, branchId } }));
    return { message: "Rules saved." };
  }

  // ───── Bookings ─────
  async bookingList(ctx: BusinessContext, rawQuery: unknown) {
    this.need(ctx, "hotel.booking.read", "hotel.calendar.read");
    const q = z.object({ from: date.optional(), to: date.optional() }).parse(rawQuery);
    const rows = await this.bookings.list(ctx, q.from && q.to ? { checkIn: { lt: dayOf(q.to) }, checkOut: { gt: dayOf(q.from) } } : { checkOut: { gte: new Date(Date.now() - 60 * 864e5) } });
    return rows.map((r) => bookingJson(r as Full));
  }
  async one(ctx: BusinessContext, id: string) {
    this.need(ctx, "hotel.booking.read", "pos.frontdesk.use");
    return bookingJson(await this.full(ctx, id));
  }

  async book(ctx: BusinessContext, raw: unknown) {
    this.need(ctx, "hotel.booking.create");
    const b = NewBooking.parse(raw);
    const from = dayOf(b.from), to = dayOf(b.to);
    const nights = nightsBetween(from, to);
    if (nights < 1) throw badRequest("Check-out must be after check-in.");
    if (nights > 365) throw badRequest("A booking can be up to a year.");
    if (from < dayOf(ymd(new Date(Date.now() - 864e5)))) throw badRequest("Check-in can't be in the past.");
    const room = b.roomId ? await this.rooms.activeInView(ctx, b.roomId) : null;
    if (b.roomId && !room) throw notFound("Room not found.");
    if (room && room.type !== b.type) throw badRequest(`Room ${room.no} is a ${room.type}.`);
    if (room && b.adults + b.children > room.maxGuests) throw badRequest(`Room ${room.no} takes up to ${room.maxGuests} guests.`);
    // The booking's branch: its room's, else the one asked for or open in the panel.
    const branchId = room?.branchId ?? ctx.branches.branchForNew(b.branchId);
    const q = await quoteStay(db(ctx) as never, { tenantId: ctx.business.id, branchId, type: b.type, from, to });
    if (q.closed.length) throw conflict(`${b.type} is closed on ${q.closed.join(", ")}. Open those dates in the calendar first.`);
    if (q.tooShort) throw badRequest(`${b.type} stays are at least ${q.tooShort} nights.`);
    // The night price from the calendar (average over the stay), unless one is agreed and typed in.
    const rate = b.rate ?? q.rate;
    const created = await this.write(ctx, async (tx) => {
      await this.checkFree(tx, branchId, b.type, room?.id ?? null, from, to);
      return (await this.bookings.create(tx, { branchId, roomId: room?.id, roomType: b.type, guestName: b.guest, phone: b.phone, email: b.email || null, adults: b.adults, children: b.children, checkIn: from, checkOut: to, rate, source: b.source, notes: b.notes })) as Full;
    }, (c) => ({ audit: { action: "booking.created", target: `${bookingCode(c)} ${b.guest}` }, event: { name: "hotel.booking.created", payload: { id: c.id, code: bookingCode(c), nights, rate }, branchId } }));
    return { message: `Booked ${bookingCode(created)}: ${b.guest}, ${n(nights)}.`, data: bookingJson(created) };
  }

  async edit(ctx: BusinessContext, id: string, raw: unknown) {
    const { version, ...b } = EditBooking.parse(raw);
    this.need(ctx, b.status === "cancelled" ? "hotel.booking.cancel" : "hotel.booking.update");
    const cur = await this.full(ctx, id);
    if (cur.status === "completed" || cur.status === "cancelled") throw badRequest("This booking is closed.");
    if (b.status === "cancelled" && cur.status === "checked_in") throw badRequest("The guest is in the room; check them out instead.");
    if (version !== undefined && version !== cur.version) throw conflict("Someone else changed this booking. Reload to see the latest.");
    const from = b.from ? dayOf(b.from) : cur.checkIn, to = b.to ? dayOf(b.to) : cur.checkOut;
    if (nightsBetween(from, to) < 1) throw badRequest("Check-out must be after check-in.");
    const roomId = b.roomId === undefined ? cur.roomId : b.roomId;
    if (b.status !== "cancelled" && (b.from || b.to || b.roomId) && roomId) {
      const r = await this.rooms.atBranch(ctx, roomId, cur.branchId);
      if (!r || r.type !== cur.roomType) throw badRequest("Pick a room of the booked type at this branch.");
    }
    await this.write(ctx, async (tx) => {
      if (b.status !== "cancelled" && (b.from || b.to || b.roomId)) await this.checkFree(tx, cur.branchId!, cur.roomType, roomId, from, to, cur.id);
      if (!(await this.bookings.move(tx, cur.id, cur.status, { status: b.status, roomId, checkIn: from, checkOut: to, notes: b.notes }))) throw conflict("Someone else changed this booking. Reload to see the latest.");
      return cur;
    }, () => ({ audit: { action: `booking.${b.status ?? "updated"}`, target: bookingCode(cur) }, event: { name: b.status === "cancelled" ? "hotel.booking.cancelled" : "hotel.booking.updated", payload: { id: cur.id, code: bookingCode(cur), status: b.status ?? cur.status }, branchId: cur.branchId } }));
    return { message: b.status === "cancelled" ? "Booking cancelled." : b.status === "confirmed" ? "Booking confirmed." : "Saved.", data: bookingJson(await this.full(ctx, cur.id)) };
  }

  // ───── Front desk ─────
  async checkIn(ctx: BusinessContext, id: string, raw: unknown) {
    this.need(ctx, "hotel.booking.update", "pos.frontdesk.use");
    const b = z.object({ roomId: z.string().max(40).optional(), idChecked: z.literal(true, { message: "See the guest's ID (citizenship, passport or licence) before checking in." }) }).parse(raw);
    const cur = await this.full(ctx, id);
    if (cur.status !== "confirmed" && cur.status !== "requested") throw badRequest(cur.status === "checked_in" ? "Already checked in." : "This booking is closed.");
    const roomId = b.roomId ?? cur.roomId;
    if (!roomId) throw badRequest("Pick a room.");
    const room = await this.rooms.atBranch(ctx, roomId, cur.branchId, true);
    if (!room || room.type !== cur.roomType) throw badRequest("Pick a room of the booked type at this branch.");
    if (room.status === "dirty" || room.status === "blocked") throw badRequest(`Room ${room.no} isn't ready (${room.status}).`);
    const nights = nightsBetween(cur.checkIn, cur.checkOut);
    await this.write(ctx, async (tx) => {
      await this.checkFree(tx, cur.branchId!, cur.roomType, room.id, cur.checkIn, cur.checkOut, cur.id);
      if (!(await this.bookings.move(tx, cur.id, cur.status, { status: "checked_in", roomId: room.id, idChecked: true, checkedIn: new Date() }))) throw badRequest("Already checked in.");
      await this.bookings.line(tx, cur.id, { kind: "room", what: `Room ${room.no} · ${n(nights)} × Rs. ${cur.rate.toLocaleString("en-IN")}`, qty: nights, amount: cur.rate * nights });
      await this.rooms.setStatus(tx, room.id, "occupied");
      return cur;
    }, () => ({ audit: { action: "booking.checked_in", target: `${bookingCode(cur)} room ${room.no}` }, event: { name: "hotel.booking.checked_in", payload: { id: cur.id, code: bookingCode(cur), roomId: room.id }, branchId: cur.branchId } }));
    return { message: `${cur.guestName} is in room ${room.no}.`, data: bookingJson(await this.full(ctx, cur.id)) };
  }

  async charge(ctx: BusinessContext, id: string, raw: unknown) {
    const b = z.object({ kind: z.enum(["extra", "discount"]), what: z.string().trim().min(2).max(120), amount: z.number().int().min(1).max(10_000_000) }).parse(raw);
    this.need(ctx, ...(b.kind === "discount" ? ["pos.bill.discount"] : ["pos.frontdesk.use", "pos.extra.create", "hotel.booking.update"]));
    const cur = await this.full(ctx, id);
    if (cur.status !== "checked_in") throw badRequest("Charges go on a room while the guest is in.");
    await this.write(ctx, (tx) => this.bookings.line(tx, cur.id, { kind: b.kind, what: b.what, amount: b.kind === "discount" ? -b.amount : b.amount }),
      () => ({ ...(b.kind === "discount" ? { audit: { action: "booking.discount", target: `${bookingCode(cur)} Rs. ${b.amount}: ${b.what}` } } : {}), event: { name: "hotel.folio.added", payload: { id: cur.id, kind: b.kind, amount: b.amount }, branchId: cur.branchId } }));
    return { message: b.kind === "discount" ? "Discount added." : "Added to the room bill.", data: bookingJson(await this.full(ctx, cur.id)) };
  }

  async pay(ctx: BusinessContext, id: string, raw: unknown) {
    this.need(ctx, "pos.frontdesk.use", "hotel.booking.update");
    const b = z.object({ method: z.enum(METHODS), amount: z.number().int().min(1).max(100_000_000), ref: z.string().trim().max(80).optional() }).parse(raw);
    const cur = await this.full(ctx, id);
    if (cur.status === "cancelled" || cur.status === "completed") throw badRequest("This booking is closed.");
    await this.write(ctx, (tx) => this.bookings.pay(tx, cur.id, b), () => ({ event: { name: "hotel.payment.received", payload: { id: cur.id, method: b.method, amount: b.amount }, branchId: cur.branchId } }));
    return { message: `Rs. ${b.amount.toLocaleString("en-IN")} received.`, data: bookingJson(await this.full(ctx, cur.id)) };
  }

  async checkOut(ctx: BusinessContext, id: string) {
    this.need(ctx, "hotel.booking.update", "pos.frontdesk.use");
    const cur = await this.full(ctx, id);
    if (cur.status !== "checked_in") throw badRequest("The guest isn't checked in.");
    const bill = folioOf(cur);
    if (bill.due > 0) throw badRequest(`Rs. ${bill.due.toLocaleString("en-IN")} is still to pay. Take the payment first.`);
    await this.write(ctx, async (tx) => {
      // Read the bill again inside the transaction: a charge added a moment ago must be paid too.
      const now = (await this.bookings.full(tx, cur.id)) as Full;
      const due = folioOf(now).due;
      if (due > 0) throw badRequest(`Rs. ${due.toLocaleString("en-IN")} is still to pay. Take the payment first.`);
      if (!(await this.bookings.move(tx, cur.id, "checked_in", { status: "completed", checkedOut: new Date() }))) throw badRequest("The guest isn't checked in.");
      if (cur.roomId) await this.rooms.setStatus(tx, cur.roomId, "dirty");
      return cur;
    }, () => ({ audit: { action: "booking.checked_out", target: bookingCode(cur) }, event: { name: "hotel.booking.checked_out", payload: { id: cur.id, code: bookingCode(cur), total: bill.total }, branchId: cur.branchId } }));
    return { message: `${cur.guestName} checked out. Room ${cur.room?.no ?? ""} goes to housekeeping.`, data: bookingJson(await this.full(ctx, cur.id)) };
  }
}
