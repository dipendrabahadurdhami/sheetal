// The only code that reads and writes rooms, bookings, room bills (folio lines), guest payments, night prices and room rules (KERNEL.md section 6).
// Where it fits: HotelService calls these, in its transaction for a change. The online travel sites (backend-core domain/ota.ts) still write bookings
// from their feeds; they are not moved here yet.
// How it works: rooms and bookings carry the kernel columns (version, who changed it, soft-delete marks). Room-bill lines and guest payments are
// append-only lines, and night prices and rules are settings rows replaced in place, so they carry none, on purpose. Every query carries this business and
// the branches in view (inView()).
// lockType() holds the rooms of one type at one branch for the transaction (SELECT … FOR UPDATE), so two bookings of that type made at the same moment
// are checked one after the other and a room can never be booked twice for a night.
// Rules: nothing is hard deleted except a night-price row going back to normal (no row needed).

import type { Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext } from "@sheetal/platform/core/context";

type Tx = Prisma.TransactionClient;
export const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
export const inView = (ctx: BusinessContext) => { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; };
const by = (ctx: BusinessContext) => { const me = actorIdOf(ctx); return { createdBy: me, updatedBy: me }; };
const bump = (ctx: BusinessContext) => ({ version: { increment: 1 }, updatedBy: actorIdOf(ctx) });
export const ACTIVE = ["requested", "confirmed", "checked_in"];
export const FULL = { branch: { select: { name: true } }, room: true, folio: { orderBy: { createdAt: "asc" as const } }, payments: { orderBy: { createdAt: "asc" as const } } };

export class RoomRepository {
  inView(ctx: BusinessContext) { return db(ctx).room.findMany({ where: { tenantId: ctx.business.id, deletedAt: null, ...inView(ctx) }, include: { branch: { select: { name: true } } }, orderBy: [{ type: "asc" }, { no: "asc" }] }); }
  countActive(ctx: BusinessContext) { return db(ctx).room.count({ where: { tenantId: ctx.business.id, active: true, deletedAt: null } }); }
  countType(ctx: BusinessContext, branchId: string, type: string) { return db(ctx).room.count({ where: { tenantId: ctx.business.id, branchId, type, active: true, deletedAt: null } }); }
  typesAt(ctx: BusinessContext, branchId: string) { return db(ctx).room.groupBy({ by: ["type"], where: { tenantId: ctx.business.id, branchId, active: true, deletedAt: null }, _count: true, orderBy: { type: "asc" } }); }
  numbersTaken(ctx: BusinessContext, nos: string[]) { return db(ctx).room.findMany({ where: { tenantId: ctx.business.id, no: { in: nos } }, select: { no: true } }); }
  async addMany(ctx: BusinessContext, rows: { no: string; type: string; rate: number; maxGuests: number; floor?: string; branchId: string; listingId?: number }[]) {
    await db(ctx).room.createMany({ data: rows.map((r) => ({ ...r, tenantId: ctx.business.id, ...by(ctx) })) });
  }
  async change(ctx: BusinessContext, id: string, data: Prisma.RoomUpdateManyMutationInput, version?: number): Promise<boolean> {
    return (await db(ctx).room.updateMany({ where: { id, tenantId: ctx.business.id, deletedAt: null, ...inView(ctx), ...(version !== undefined ? { version } : {}) }, data: { ...data, ...bump(ctx) } })).count > 0;
  }
  exists(ctx: BusinessContext, id: string) { return db(ctx).room.findFirst({ where: { id, tenantId: ctx.business.id, deletedAt: null, ...inView(ctx) }, select: { id: true } }); }
  /** A room of this business in view (active). */
  activeInView(ctx: BusinessContext, id: string) { return db(ctx).room.findFirst({ where: { id, tenantId: ctx.business.id, active: true, deletedAt: null, ...inView(ctx) } }); }
  /** A room at one branch (any status; `active` when asked). */
  atBranch(ctx: BusinessContext, id: string, branchId: string | null, active = false) { return db(ctx).room.findFirst({ where: { id, tenantId: ctx.business.id, branchId, deletedAt: null, ...(active ? { active: true } : {}) } }); }
  setStatus(ctx: BusinessContext, id: string, status: string) { return db(ctx).room.update({ where: { id }, data: { status, ...bump(ctx) } }); }
  /** Holds the rooms of a type at a branch until the transaction ends (see the header). */
  async lockType(ctx: BusinessContext, branchId: string, type: string) {
    await db(ctx).$queryRaw`SELECT id FROM rooms WHERE tenant_id = ${ctx.business.id} AND branch_id = ${branchId} AND type = ${type} FOR UPDATE`;
  }
  /** The plan's limits (rooms, or units for a host); -1 or missing = no limit. */
  async planLimits(ctx: BusinessContext): Promise<Record<string, number>> {
    const t = await db(ctx).tenant.findFirst({ where: { id: ctx.business.id }, select: { plan: { select: { limits: true } } } });
    return (t?.plan.limits ?? {}) as Record<string, number>;
  }
}

export class BookingRepository {
  /** Bookings at a branch that hold a room on at least one of the nights [from, to), other than `except`. */
  taken(ctx: BusinessContext, branchId: string, from: Date, to: Date, except?: string) {
    return db(ctx).booking.findMany({ where: { tenantId: ctx.business.id, branchId, deletedAt: null, status: { in: ACTIVE }, checkIn: { lt: to }, checkOut: { gt: from }, ...(except ? { id: { not: except } } : {}) }, select: { roomId: true, roomType: true, checkIn: true, checkOut: true } });
  }
  /** Guests in house, and confirmed arrivals today, with a room (for the front desk). */
  current(ctx: BusinessContext, today: Date) {
    return db(ctx).booking.findMany({ where: { tenantId: ctx.business.id, deletedAt: null, ...inView(ctx), roomId: { not: null }, OR: [{ status: "checked_in" }, { status: "confirmed", checkIn: today }] }, include: { room: true, folio: true, payments: true } });
  }
  list(ctx: BusinessContext, where: Prisma.BookingWhereInput) {
    return db(ctx).booking.findMany({ where: { tenantId: ctx.business.id, deletedAt: null, ...inView(ctx), ...where }, include: { branch: { select: { name: true } }, room: true, folio: true, payments: true }, orderBy: { checkIn: "asc" }, take: 2000 });
  }
  full(ctx: BusinessContext, id: string) { return db(ctx).booking.findFirst({ where: { id, tenantId: ctx.business.id, deletedAt: null, ...inView(ctx) }, include: FULL }); }
  create(ctx: BusinessContext, data: Omit<Prisma.BookingUncheckedCreateInput, "tenantId">) { return db(ctx).booking.create({ data: { ...data, tenantId: ctx.business.id, ...by(ctx) }, include: FULL }); }
  /** Changes a booking only from the status it had (false = someone changed it first). */
  async move(ctx: BusinessContext, id: string, from: string, data: Prisma.BookingUpdateManyMutationInput & { roomId?: string | null }): Promise<boolean> {
    return (await db(ctx).booking.updateMany({ where: { id, tenantId: ctx.business.id, status: from }, data: { ...data, ...bump(ctx) } as Prisma.BookingUncheckedUpdateManyInput })).count > 0;
  }
  line(ctx: BusinessContext, bookingId: string, d: { kind: string; what: string; amount: number; qty?: number }) { return db(ctx).folioLine.create({ data: { bookingId, ...d, byUserId: ctx.member.userId } }); }
  pay(ctx: BusinessContext, bookingId: string, d: { method: string; amount: number; ref?: string }) { return db(ctx).guestPayment.create({ data: { bookingId, ...d, byUserId: ctx.member.userId } }); }
}

export class CalendarRepository {
  day(ctx: BusinessContext, branchId: string, roomType: string, day: Date) { return db(ctx).rateDay.findUnique({ where: { branchId_roomType_day: { branchId, roomType, day } } }); }
  clearDay(ctx: BusinessContext, branchId: string, roomType: string, day: Date) { return db(ctx).rateDay.delete({ where: { branchId_roomType_day: { branchId, roomType, day } } }); }
  setDay(ctx: BusinessContext, branchId: string, roomType: string, day: Date, next: { rate: number | null; closed: boolean }) {
    return db(ctx).rateDay.upsert({ where: { branchId_roomType_day: { branchId, roomType, day } }, create: { tenantId: ctx.business.id, branchId, roomType, day, ...next }, update: next });
  }
  setRule(ctx: BusinessContext, branchId: string, roomType: string, r: { weekendPct: number; minNights: number }) {
    return db(ctx).roomRule.upsert({ where: { branchId_roomType: { branchId, roomType } }, create: { tenantId: ctx.business.id, branchId, roomType, ...r }, update: r });
  }
}
