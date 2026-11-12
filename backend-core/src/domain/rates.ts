// Night prices and closed nights for a room type at a branch (the hotel calendar).
// Where it fits: used by the calendar screen, new bookings, availability, and the calendar sent to Booking.com/Airbnb.
// How it works: a night costs the price set for that date, otherwise the room type's lowest room rate plus the weekend
// markup on Friday and Saturday nights, rounded to Rs. 50.
// Rules: closed nights and stays shorter than the minimum take no new bookings.

import type { Db } from "@sheetal/platform/db/client";
import { ymd } from "./money.js";

export interface Night { day: string; price: number; override: number | null; closed: boolean; weekend: boolean }
export interface Rule { weekendPct: number; minNights: number }

/** Friday and Saturday nights (check-in day of the week, UTC dates). */
export const weekendNight = (d: Date) => d.getUTCDay() === 5 || d.getUTCDay() === 6;
const round50 = (n: number) => Math.round(n / 50) * 50;

export async function nightsOf(db: Db, o: { tenantId: string; branchId: string; type: string; from: Date; to: Date }) {
  const [rooms, rule, days] = await Promise.all([
    db.room.aggregate({ where: { tenantId: o.tenantId, branchId: o.branchId, type: o.type, active: true }, _min: { rate: true }, _count: true }),
    db.roomRule.findUnique({ where: { branchId_roomType: { branchId: o.branchId, roomType: o.type } } }),
    db.rateDay.findMany({ where: { branchId: o.branchId, roomType: o.type, day: { gte: o.from, lt: o.to } } }),
  ]);
  const base = rooms._min.rate ?? 0;
  const r: Rule = { weekendPct: rule?.weekendPct ?? 0, minNights: rule?.minNights ?? 1 };
  const byDay = new Map(days.map((d) => [ymd(d.day), d]));
  const nights: Night[] = [];
  for (let t = o.from.getTime(); t < o.to.getTime(); t += 864e5) {
    const d = new Date(t);
    const key = ymd(d);
    const set = byDay.get(key);
    const weekend = weekendNight(d);
    const normal = round50(base * (1 + (weekend ? r.weekendPct : 0) / 100));
    nights.push({ day: key, price: set?.rate ?? normal, override: set?.rate ?? null, closed: !!set?.closed, weekend });
  }
  return { base, rooms: rooms._count, rule: r, nights };
}

/** What a stay costs and whether it can be booked: total, the average night price, and why not (closed, too short). */
export async function quoteStay(db: Db, o: { tenantId: string; branchId: string; type: string; from: Date; to: Date }) {
  const { nights, rule } = await nightsOf(db, o);
  const total = nights.reduce((s, n) => s + n.price, 0);
  const closed = nights.filter((n) => n.closed).map((n) => n.day);
  return { total, rate: nights.length ? Math.round(total / nights.length) : 0, nights, closed, tooShort: nights.length < rule.minNights ? rule.minNights : null };
}

