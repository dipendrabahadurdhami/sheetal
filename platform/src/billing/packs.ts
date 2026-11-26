// Software packs (the owner's plan of 27 Nov 2026): Sheetal Technology sells its business software as three packs, Starter, Business and Pro,
// instead of app by app. The website side (listings, jobs, reviews, forms: Sheetal CMS) is free for everyone.
// Where it fits: the packs live in the catalog (platform.catalog, edited in Admin -> Pricing, so super admin changes every price and the
// offer); the business panel's Plans page shows them and buys one (business/backend/src/modules/packs); the technology landing page shows the
// public part (publicPacks).
// How it works: a pack is a list of software; each software is a group of apps (SOFTWARE below, the one grouping table). Buying a pack is one
// invoice with a subscription line per live app of the pack, at the app's top edition, for the same 1, 6 or 12 months. The pack price is
// shared over the lines by each app's list price (the last line takes the rounding), so the lines add up to the pack price exactly and every
// renewal (each subscription keeps its own share) adds up to it again. So the invoice, the tax number, the revenue rows, refunds, grace and
// read-only all work as for any app: nothing new in the money path. Apps still "coming soon" are shown in the pack but not charged; they join
// at the next renewal once live.
// Rules: pure (no clock, no database: `now`, the business and the catalog come in). Money is paisa, VAT included (split once from the total).

import { Money } from "../core/money.js";
import { addMonthsOnAnchor, anchorOf, startOfNepalDay } from "./days.js";
import type { BillingSettings, BillingState, Catalog, Quote, QuoteLine, Text } from "./types.js";

export type PackPeriod = 1 | 6 | 12;
export const PACK_PERIODS: readonly PackPeriod[] = [1, 6, 12];
export type PackPrices = { m1: number; m6: number; m12: number };

export interface Pack {
  name: Text;
  tagline: Text;
  sort: number;
  /** Shown as "Most popular". */
  highlight: boolean;
  /** Software ids (SOFTWARE). */
  software: string[];
  /** Normal prices in paisa, VAT included. */
  prices: PackPrices;
  /** The offer: shown and charged instead of the normal price while switched on (the normal price is shown crossed out). */
  offer: { enabled: boolean; label: Text; prices: PackPrices };
}

export interface Software { id: string; name: Text; tagline: Text; icon: string; free: boolean; apps: string[] }

/** The one grouping of today's apps into software products. Free software is in every pack and also free without one. */
export const SOFTWARE: readonly Software[] = [
  { id: "cms", name: { en: "Sheetal CMS" }, tagline: { en: "Post property, hotels, projects, jobs and reviews on the website. Free." }, icon: "globe", free: true, apps: ["listings", "reviews"] },
  { id: "crm", name: { en: "Sheetal CRM" }, tagline: { en: "Leads, customers, inbox, team email and follow-ups." }, icon: "messages-square", free: false, apps: ["crm", "mail"] },
  { id: "accounting", name: { en: "Sheetal Accounting" }, tagline: { en: "Invoices, payouts, expenses, profit and instalments." }, icon: "receipt", free: false, apps: ["invoicing", "expenses", "collections", "accounting"] },
  { id: "hrm", name: { en: "Sheetal HRM" }, tagline: { en: "Staff records, attendance, leave and payroll." }, icon: "users-round", free: false, apps: ["people", "payroll"] },
  { id: "property", name: { en: "Sheetal Property Management" }, tagline: { en: "Rentals, rent bills, agreements and e-sign." }, icon: "key-round", free: false, apps: ["rentals", "agreements"] },
  { id: "hospitality", name: { en: "Sheetal Hospitality" }, tagline: { en: "Hotel bookings, rooms, channels, point of sale and stock." }, icon: "hotel", free: false, apps: ["hotel", "pos", "restaurant"] },
  { id: "projects", name: { en: "Sheetal Projects" }, tagline: { en: "Projects, units, reservations, progress and investors." }, icon: "building-2", free: false, apps: ["projects", "investments"] },
  { id: "growth", name: { en: "Sheetal Promote" }, tagline: { en: "Featured listings and home page banners." }, icon: "rocket", free: false, apps: ["promote"] },
];

const rs = (rupees: number) => rupees * 100;
/** 6 months saves 10%, a year saves 20%, ending in 99 (the owner's prices). */
const periods = (monthly: number): PackPrices => {
  const end99 = (x: number) => Math.ceil(x / 100) * 100 - 1;
  return { m1: rs(monthly), m6: rs(end99(monthly * 6 * 0.9)), m12: rs(end99(monthly * 12 * 0.8)) };
};
const pack = (o: { name: string; tagline: string; sort: number; highlight?: boolean; software: string[]; monthly: number; offer: number }): Pack => ({
  name: { en: o.name }, tagline: { en: o.tagline }, sort: o.sort, highlight: !!o.highlight, software: o.software,
  prices: periods(o.monthly), offer: { enabled: true, label: { en: "Launch offer" }, prices: periods(o.offer) },
});

/** The first packs (Admin -> Pricing changes them). */
export const SEED_PACKS: Record<string, Pack> = {
  starter: pack({ name: "Starter", tagline: "Sell and get paid: CRM and accounting.", sort: 1, software: ["cms", "crm", "accounting"], monthly: 4999, offer: 3999 }),
  business: pack({ name: "Business", tagline: "Run the office: adds HRM and property management.", sort: 2, highlight: true, software: ["cms", "crm", "accounting", "hrm", "property"], monthly: 9999, offer: 8999 }),
  pro: pack({ name: "Pro", tagline: "Everything, for many branches and businesses.", sort: 3, software: SOFTWARE.map((s) => s.id), monthly: 14999, offer: 13999 }),
};

/** The apps a pack gives, in order, without repeats (free software included). */
export function packApps(p: Pick<Pack, "software">): string[] {
  const ids = new Set<string>();
  for (const s of SOFTWARE) if (s.free || p.software.includes(s.id)) s.apps.forEach((a) => ids.add(a));
  return [...ids];
}

/** What a pack costs for a period now: the offer price while the offer is on, and the normal one to show crossed out. */
export function packPrice(p: Pack, months: PackPeriod): { pricePaisa: number; normalPaisa: number; onOffer: boolean } {
  const k = `m${months}` as keyof PackPrices;
  const normal = p.prices[k];
  const offer = p.offer.enabled ? p.offer.prices[k] : null;
  return offer != null && offer > 0 && offer < normal ? { pricePaisa: offer, normalPaisa: normal, onOffer: true } : { pricePaisa: normal, normalPaisa: normal, onOffer: false };
}

/** The top paid edition of an app (the most expensive), or null for an app with no paid edition. */
export function topEdition(cat: Catalog, appId: string): string | null {
  const eds = Object.entries(cat.apps[appId]?.editions ?? {}).filter(([, e]) => !e.free).sort((x, y) => y[1].priceMonthPaisa - x[1].priceMonthPaisa);
  return eds[0]?.[0] ?? null;
}

/** Problems that make the packs unsafe to save (Admin -> Pricing), as plain sentences. */
export function packProblems(packs: Record<string, Pack> | undefined, cat: Pick<Catalog, "apps">): string[] {
  const out: string[] = [];
  if (!packs) return out;
  const known = new Set(SOFTWARE.map((s) => s.id));
  for (const [id, p] of Object.entries(packs)) {
    const name = p.name.en || id;
    if (!p.software.length) out.push(`${name}: choose at least one software.`);
    for (const s of p.software) if (!known.has(s)) out.push(`${name}: "${s}" isn't one of the software products.`);
    if (!packApps(p).some((a) => cat.apps[a]?.availability === "live" && topEdition(cat as Catalog, a))) out.push(`${name}: none of its apps can be sold yet.`);
    for (const which of ["prices", "offer"] as const) {
      const pr = which === "prices" ? p.prices : p.offer.prices;
      const what = which === "prices" ? "price" : "offer price";
      if (which === "prices" || p.offer.enabled) {
        if (pr.m1 <= 0) out.push(`${name}: the monthly ${what} is needed.`);
        if (pr.m6 > pr.m1 * 6) out.push(`${name}: the 6-month ${what} can't be more than 6 monthly prices.`);
        if (pr.m12 > pr.m1 * 12) out.push(`${name}: the yearly ${what} can't be more than 12 monthly prices.`);
      }
    }
    if (p.offer.enabled) for (const k of ["m1", "m6", "m12"] as const) if (p.offer.prices[k] >= p.prices[k]) out.push(`${name}: the offer price must be lower than the normal price.`);
  }
  return out;
}

export interface PackQuoteInput {
  now: Date;
  business: BillingState;
  catalog: Catalog;
  settings: BillingSettings;
  packId: string;
  months: number;
}

const day = (d: Date) => new Date(d.getTime() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 10);

/** The invoice lines of buying a pack. Same shape as quote(), so the checkout stores it the same way. */
export function packQuote(i: PackQuoteInput): Quote & { packId: string; months: number; normalPaisa: number; onOffer: boolean; comingSoon: string[] } {
  const errors: Text[] = [];
  const notes: Text[] = [];
  const warnings: Text[] = [];
  const p = i.catalog.packs?.[i.packId];
  const months = i.months as PackPeriod;
  const empty = { lines: [] as QuoteLine[], discountPaisa: 0, subtotalPaisa: 0, vatPaisa: 0, totalPaisa: 0, carryPaisa: 0, anchorDay: i.business.anchorDay, dueAt: new Date(i.now.getTime() + i.settings.quoteHours * 3_600_000), notes, warnings, errors, packId: i.packId, months: i.months, normalPaisa: 0, onOffer: false, comingSoon: [] as string[] };
  if (!p) { errors.push({ en: "That pack doesn't exist." }); return empty; }
  if (!PACK_PERIODS.includes(months)) { errors.push({ en: "Choose 1 month, 6 months or 1 year." }); return empty; }
  const price = packPrice(p, months);
  const appName = (id: string) => i.catalog.apps[id]?.name?.en ?? id;
  const all = packApps(p).filter((a) => i.catalog.apps[a]);
  const sellable = all.filter((a) => i.catalog.apps[a]!.availability === "live" && topEdition(i.catalog, a));
  const comingSoon = all.filter((a) => i.catalog.apps[a]!.availability !== "live").map(appName);
  if (!sellable.length) { errors.push({ en: `${p.name.en}: none of its apps can be sold yet.` }); return { ...empty, normalPaisa: price.normalPaisa, onOffer: price.onOffer }; }

  // An app the business already pays for (its own purchase, still running) would be paid twice.
  const running = i.business.subscriptions.filter((s) => sellable.includes(s.appId) && s.periodMonths != null && s.currentPeriodEnd && i.now < s.currentPeriodEnd && !s.uninstalledAt);
  for (const s of running) errors.push({ en: `You already pay for ${appName(s.appId)} until ${day(s.currentPeriodEnd!)}. Choose a pack when it ends, or ask Sheetal to switch you now.` });

  // Share the pack price over the apps by their monthly list price; the last line takes the rounding.
  const weights = sellable.map((a) => Math.max(i.catalog.apps[a]!.editions[topEdition(i.catalog, a)!]!.priceMonthPaisa, 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  const today = startOfNepalDay(i.now);
  const end = addMonthsOnAnchor(i.now, months, anchorOf(i.now));
  const length = months === 1 ? "1 month" : months === 12 ? "1 year" : "6 months";
  const drafts = sellable.map((a, k) => {
    const share = k === sellable.length - 1 ? price.pricePaisa - given : Math.floor((price.pricePaisa * weights[k]!) / sum);
    given += share;
    const ed = topEdition(i.catalog, a)!;
    return {
      kind: "subscription" as const, appId: a, editionId: ed, saleType: "new" as const,
      description: { en: `${p.name.en} pack · ${appName(a)} · ${length}`, packId: i.packId } as Text,
      periodStart: today, periodEnd: end, periodMonths: months, qty: 1, unitGrossPaisa: share, discountPaisa: 0, grossPaisa: share,
    };
  });
  if (comingSoon.length) notes.push({ en: `Coming soon in this pack at no extra cost: ${comingSoon.join(", ")}.` });
  notes.push({ en: `${p.name.en} runs until ${day(end)}${months === 1 ? " and renews every month" : months === 12 ? " and renews every year" : " and renews every 6 months"}.` });

  // VAT once from the total; each line its own share, the biggest line takes the rounding (as quote()).
  const total = Money.paisa(price.pricePaisa);
  const split = total.splitVat(i.settings.vatRatePct);
  const vats = drafts.map((d) => Money.paisa(d.grossPaisa).splitVat(i.settings.vatRatePct).vat);
  const diff = split.vat.minus(vats.reduce((a, b) => a.plus(b), Money.zero()));
  if (!diff.isZero()) {
    let big = 0;
    drafts.forEach((d, k) => { if (d.grossPaisa > drafts[big]!.grossPaisa) big = k; });
    vats[big] = vats[big]!.plus(diff);
  }
  const lines: QuoteLine[] = drafts.map((d, k) => ({ ...d, vatPaisa: vats[k]!.paisa, netPaisa: d.grossPaisa - vats[k]!.paisa }));
  if (!i.settings.salesEnabled) warnings.push({ en: "Sales are switched off: this is a preview only." });
  return {
    lines, discountPaisa: 0, subtotalPaisa: split.subtotal.paisa, vatPaisa: split.vat.paisa, totalPaisa: total.paisa, carryPaisa: 0,
    anchorDay: months === 1 ? anchorOf(i.now) : i.business.anchorDay, dueAt: new Date(i.now.getTime() + i.settings.quoteHours * 3_600_000),
    notes, warnings, errors, packId: i.packId, months: i.months, normalPaisa: price.normalPaisa, onOffer: price.onOffer, comingSoon,
  };
}

/** What anyone may see: the packs with their software, prices and offer (the technology landing page and the Plans page). */
export function publicPacks(cat: Catalog) {
  const packs = Object.entries(cat.packs ?? {}).sort(([, a], [, b]) => a.sort - b.sort).map(([id, p]) => ({
    id, name: p.name, tagline: p.tagline, highlight: p.highlight, software: [...p.software],
    periods: PACK_PERIODS.map((m) => ({ months: m, ...packPrice(p, m) })),
    offerLabel: p.offer.enabled ? p.offer.label : null,
  }));
  const software = SOFTWARE.map((s) => ({
    id: s.id, name: s.name, tagline: s.tagline, icon: s.icon, free: s.free,
    apps: s.apps.filter((a) => cat.apps[a]).map((a) => ({ id: a, name: cat.apps[a]!.name ?? { en: a }, comingSoon: cat.apps[a]!.availability !== "live" })),
  }));
  return { packs, software, vatIncluded: true };
}
