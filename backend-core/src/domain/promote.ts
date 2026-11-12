// Promote: paid boosts that put a listing in a place on the website for some days, the plan's free featured slots,
// and the order the website shows boosted listings in.
// Where it fits: the business API sells boosts and moves or stops them (business/backend/src/modules/promote); the
// admin API sets prices and spots (Admin → Promote); the website API shows boosted listings first
// (website/backend/src/modules/catalog) and counts their views and clicks (website/backend/src/modules/promote).
// How it works: three places: home (the home page's featured row), search (the top of every buy, rent and search
// list) and city (the top of results for one city). Each place has a price a day and a number of spots; a boost holds
// a spot for each of its days, so a full place offers the next free start date. Buying makes a "boost" invoice paid the
// normal way (eSewa, Khalti, Fonepay, or a bank transfer Sheetal confirms); once paid the boost runs by itself on its
// dates. A boost can move to another listing of the business for the days left, or be stopped (no refund). Gift
// boosts (listings featured on the old website) are free and don't take a paid spot.
// Rules: VAT is included in the prices, like plans. Website order: boosted listings first (in the order they were
// paid), then the newest. Free featured slots (the plan's "featured" limit) put a listing in the home row after the
// boosted ones, for as long as the business keeps it there.

import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import { dayOf, ymd } from "./money.js";
import { nepalDay } from "./payouts.js";

type Tx = Db | Prisma.TransactionClient;
export const PLACES = ["home", "search", "city"] as const;
export type Place = (typeof PLACES)[number];
export const PLACE_LABEL: Record<Place, string> = { home: "Home page: featured", search: "Top of search results", city: "City page" };
export const PLACE_SUB: Record<Place, string> = {
  home: "In the featured row on the home page.",
  search: "First in buy, rent and search results.",
  city: "First when people look for property in the listing's city.",
};
/** Search and city boosts are for property listings (the buy and rent pages); the home row takes any listing. */
export const SEARCH_KINDS = ["sell", "rentout"];

export interface PlaceSettings { price: number; spots: number; active: boolean }
/** hero: the home page banner (domain/banners.ts); its spots are banners that slide in turn. */
export interface PromoteSettings { home: PlaceSettings; search: PlaceSettings; city: PlaceSettings; hero: PlaceSettings; lengths: number[] }
export const PROMOTE_DEFAULTS: PromoteSettings = {
  home: { price: 500, spots: 12, active: true },
  search: { price: 300, spots: 10, active: true },
  city: { price: 200, spots: 6, active: true },
  hero: { price: 1500, spots: 3, active: true },
  lengths: [3, 7, 14, 30],
};
export const GIFT_DAYS = 30;

export async function promoteSettings(db: Tx): Promise<PromoteSettings> {
  const v = ((await db.appSetting.findUnique({ where: { key: "promote" } }))?.value ?? {}) as Partial<PromoteSettings>;
  return {
    home: { ...PROMOTE_DEFAULTS.home, ...(v.home ?? {}) },
    search: { ...PROMOTE_DEFAULTS.search, ...(v.search ?? {}) },
    city: { ...PROMOTE_DEFAULTS.city, ...(v.city ?? {}) },
    hero: { ...PROMOTE_DEFAULTS.hero, ...(v.hero ?? {}) },
    lengths: v.lengths?.length ? v.lengths : PROMOTE_DEFAULTS.lengths,
  };
}

export const boostNo = (seq: number) => `BS-${String(seq).padStart(4, "0")}`;
export const addDays = (day: string, n: number) => { const d = dayOf(day); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
export const daysBetween = (a: string, b: string) => Math.round((dayOf(b).getTime() - dayOf(a).getTime()) / 864e5);
export const today = () => nepalDay();
const cityKey = (c?: string | null) => (c ?? "").trim().toLowerCase();

/** How long an unpaid boost keeps its spot while the business pays (a bank transfer being checked keeps it longer). */
const HOLD_MS = 2 * 3_600_000;

/** Boosts that take a paid spot in a place: paid ones not stopped, and unpaid ones still being paid for. */
async function heldBoosts(db: Tx, place: Place, city: string, from: string, to: string, exceptId?: string) {
  const rows = await db.boost.findMany({
    where: {
      place, source: "paid", ...(place === "city" ? { city: cityKey(city) } : {}), id: exceptId ? { not: exceptId } : undefined,
      startOn: { lte: dayOf(to) }, endOn: { gte: dayOf(from) }, status: { in: ["paid", "awaiting"] },
    },
    select: { id: true, status: true, startOn: true, endOn: true, createdAt: true, invoiceId: true },
  });
  const waiting = rows.filter((r) => r.status === "awaiting" && r.invoiceId);
  const checking = waiting.length ? new Set((await db.payment.findMany({ where: { invoiceId: { in: waiting.map((r) => r.invoiceId!) }, status: "pending_review" }, select: { invoiceId: true } })).map((p) => p.invoiceId)) : new Set<string>();
  const open = waiting.length ? new Set((await db.invoice.findMany({ where: { id: { in: waiting.map((r) => r.invoiceId!) }, status: "open" }, select: { id: true } })).map((i) => i.id)) : new Set<string>();
  const now = Date.now();
  return rows.filter((r) => r.status === "paid" || (open.has(r.invoiceId!) && (checking.has(r.invoiceId!) || now - r.createdAt.getTime() < HOLD_MS)));
}

/** The first start day (from `from`) with a free spot on every one of `days` days, looking up to a year ahead. */
export async function nextFreeStart(db: Tx, o: { place: Place; city?: string | null; days: number; from?: string; spots: number; exceptId?: string }) {
  const from = o.from ?? today();
  const until = addDays(from, 365 + o.days);
  const held = await heldBoosts(db, o.place, o.city ?? "", from, until, o.exceptId);
  const used = new Map<string, number>();
  for (const b of held) for (let d = ymd(b.startOn); d <= ymd(b.endOn); d = addDays(d, 1)) used.set(d, (used.get(d) ?? 0) + 1);
  for (let s = from; s <= addDays(from, 365); s = addDays(s, 1)) {
    let ok = true;
    for (let i = 0; i < o.days && ok; i++) if ((used.get(addDays(s, i)) ?? 0) >= o.spots) ok = false;
    if (ok) return s;
  }
  return null;
}

/** Spots taken today in each place (and in each city), for showing how full places are. */
export async function takenToday(db: Tx) {
  const d = dayOf(today());
  const rows = await db.boost.findMany({ where: { source: "paid", status: "paid", startOn: { lte: d }, endOn: { gte: d } }, select: { place: true, city: true } });
  const out = { home: 0, search: 0, city: {} as Record<string, number> };
  for (const r of rows) if (r.place === "city") out.city[r.city] = (out.city[r.city] ?? 0) + 1; else out[r.place as "home" | "search"]++;
  return out;
}

/** The listing ids boosted in these places today, in the order they were paid (gifts after paid ones). */
export async function liveBoosted(db: Tx, places: Place[], city?: string | null) {
  const d = dayOf(today());
  const or: Prisma.BoostWhereInput[] = places.filter((p) => p !== "city").map((p) => ({ place: p }));
  if (places.includes("city") && cityKey(city)) or.push({ place: "city", city: cityKey(city) });
  if (!or.length) return [] as { listingId: number; place: Place }[];
  const rows = await db.boost.findMany({ where: { status: "paid", startOn: { lte: d }, endOn: { gte: d }, OR: or }, orderBy: [{ source: "desc" }, { paidAt: "asc" }], select: { listingId: true, place: true } });
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.listingId) ? false : (seen.add(r.listingId), true))).map((r) => ({ listingId: r.listingId, place: r.place as Place }));
}

export type Phase = "awaiting" | "checking" | "scheduled" | "live" | "listing_off" | "ended" | "stopped" | "cancelled";
export const PHASE_LABEL: Record<Phase, string> = {
  awaiting: "Waiting for payment", checking: "Bank transfer being checked", scheduled: "Starts soon", live: "Live",
  listing_off: "Listing not on the website", ended: "Ended", stopped: "Stopped", cancelled: "Cancelled",
};
export function phaseOf(b: { status: string; startOn: Date; endOn: Date }, o: { day?: string; listingLive: boolean; checking?: boolean; invoiceOpen?: boolean }): Phase {
  const day = o.day ?? today();
  if (b.status === "void") return "cancelled";
  if (b.status === "stopped") return "stopped";
  if (b.status === "awaiting") return o.invoiceOpen === false ? "cancelled" : o.checking ? "checking" : "awaiting";
  if (ymd(b.endOn) < day) return "ended";
  if (!o.listingLive) return "listing_off";
  return ymd(b.startOn) > day ? "scheduled" : "live";
}

/** A paid boost invoice starts its boosts. Paid after the planned start, a boost starts today and keeps its days. */
export async function activateBoosts(tx: Tx, invoiceId: string, now = new Date()) {
  const day = nepalDay(now);
  const rows = await tx.boost.findMany({ where: { invoiceId, status: "awaiting" } });
  for (const b of rows) {
    const late = ymd(b.startOn) < day;
    await tx.boost.update({ where: { id: b.id }, data: { status: "paid", paidAt: now, ...(late ? { startOn: dayOf(day), endOn: dayOf(addDays(day, b.days - 1)) } : {}) } });
  }
  return rows.length;
}

/** The invoice line for a boost (kept in the invoice's add-on lines, so invoices and earnings show it). */
export const boostLine = (o: { place: Place; days: number; price: number; code: string; city?: string }) => ({
  id: "boost", name: `Boost ${o.code}: ${PLACE_LABEL[o.place]}${o.place === "city" && o.city ? ` (${o.city})` : ""}, ${o.days} days`, qty: o.days, price: o.price, months: 1,
});
