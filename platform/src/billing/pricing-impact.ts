// What a catalog change does to businesses that already have the apps (MARKETPLACE-AND-BILLING.md sections 3.2 and 5.6, P3-BE-7).
// Where it fits: Admin -> Pricing (admin/backend/src/modules/pricing.ts) calls pricingImpact() before saving: the screen shows the answer
// ("N businesses pay for this"), a change that needs a second staff member goes to a PlatformApproval, and a refused change is never saved.
// How it works: compares the saved catalog with the new one, edition by edition and add-on by add-on, using the subscriber counts the route
// read from the database. A price RISE or a CUT of a paid limit that paying businesses have needs approval; a price cut never does; a cut of
// a free limit is only shown. Turning off something businesses use (an app back to "coming soon", the free edition off, an edition switched
// between free and paid) is refused: the screen offers "hide from new sales" (visible = false) instead.
// Rules: pure. Counts are per "appId:editionId"; add-on counts per add-on key ("" + key for business-wide add-ons such as seats).

import type { Catalog, CatalogLimit } from "./types.js";

export interface EditionCounts { paying: number; trialing: number; free: number }
export interface ImpactCounts { editions: Record<string, EditionCounts>; addons: Record<string, number>; businessAddons: number }

export type ChangeKind = "price_rise" | "price_cut" | "paid_limit_cut" | "free_limit_cut" | "limit_raise" | "hidden" | "shown" | "other";
export interface Change { kind: ChangeKind; appId: string | null; editionId: string | null; addonKey?: string; what: string; from: unknown; to: unknown; paying: number; free: number }
export interface Impact { changes: Change[]; refused: string[]; needsApproval: boolean; payingAffected: number }

const ZERO: EditionCounts = { paying: 0, trialing: 0, free: 0 };
const countOf = (c: ImpactCounts, appId: string, editionId: string) => c.editions[`${appId}:${editionId}`] ?? ZERO;
const rank = (l: CatalogLimit | undefined) => (l == null ? Number.POSITIVE_INFINITY : l.value == null ? Number.POSITIVE_INFINITY : l.value);
const rupees = (p: number) => `Rs ${(p / 100).toFixed(2)}`;

export function pricingImpact(prev: Catalog, next: Catalog, counts: ImpactCounts): Impact {
  const changes: Change[] = [];
  const refused: string[] = [];
  for (const [appId, app] of Object.entries(next.apps)) {
    const was = prev.apps[appId];
    if (!was) continue; // a new app has no subscribers yet
    const users = Object.keys(was.editions).reduce((a, ed) => { const c = countOf(counts, appId, ed); return a + c.paying + c.trialing + c.free; }, 0);
    if (was.availability === "live" && app.availability !== "live" && users > 0) refused.push(`${appId}: ${users} businesses use this app, so it can't go back to "coming soon". Hide it from new sales instead.`);
    if (was.freeEditionEnabled && !app.freeEditionEnabled) {
      const free = Object.entries(was.editions).filter(([, e]) => e.free).reduce((a, [ed]) => a + countOf(counts, appId, ed).free, 0);
      if (free > 0) refused.push(`${appId}: ${free} businesses use the free edition, so it can't be switched off. Hide the app from new sales instead.`);
    }
    if (was.visible !== app.visible) changes.push({ kind: app.visible ? "shown" : "hidden", appId, editionId: null, what: app.visible ? "shown in the marketplace" : "hidden from new sales", from: was.visible, to: app.visible, paying: 0, free: 0 });
    for (const [ed, e] of Object.entries(app.editions)) {
      const old = was.editions[ed];
      if (!old) continue;
      const c = countOf(counts, appId, ed);
      if (old.free !== e.free && c.paying + c.trialing + c.free > 0) refused.push(`${appId} ${ed}: businesses use this edition, so it can't switch between free and paid.`);
      for (const [field, label] of [["priceMonthPaisa", "monthly price"], ["priceYearPaisa", "yearly price"]] as const) {
        if (old[field] === e[field]) continue;
        const rise = e[field] > old[field];
        changes.push({ kind: rise ? "price_rise" : "price_cut", appId, editionId: ed, what: `${label} ${rupees(old[field])} -> ${rupees(e[field])}`, from: old[field], to: e[field], paying: c.paying, free: c.free });
      }
      for (const key of new Set([...Object.keys(old.limits), ...Object.keys(e.limits)])) {
        const a = old.limits[key], b = e.limits[key];
        const lower = rank(b) < rank(a) || (a?.behaviour === "soft" && b?.behaviour === "hard");
        const higher = rank(b) > rank(a) || (a?.behaviour === "hard" && b?.behaviour === "soft");
        if (!lower && !higher) continue;
        const show = (l: CatalogLimit | undefined) => (l == null || l.value == null ? "unlimited" : `${l.value} (${l.behaviour})`);
        const kind: ChangeKind = lower ? (e.free ? "free_limit_cut" : "paid_limit_cut") : "limit_raise";
        changes.push({ kind, appId, editionId: ed, what: `limit ${key} ${show(a)} -> ${show(b)}`, from: a ?? null, to: b ?? null, paying: c.paying, free: c.free });
      }
    }
  }
  for (const a of next.addons) {
    const old = prev.addons.find((x) => x.key === a.key);
    if (!old) continue;
    for (const [field, label] of [["priceMonthPaisa", "monthly price"], ["priceYearPaisa", "yearly price"]] as const) {
      if (old[field] === a[field]) continue;
      const rise = a[field] > old[field];
      changes.push({ kind: rise ? "price_rise" : "price_cut", appId: a.appId, editionId: null, addonKey: a.key, what: `add-on ${a.key} ${label} ${rupees(old[field])} -> ${rupees(a[field])}`, from: old[field], to: a[field], paying: counts.addons[a.key] ?? 0, free: 0 });
    }
  }
  for (const [part, label] of [["seatAddon", "seat"], ["storageAddon", "storage"]] as const) {
    for (const field of ["priceMonthPaisa", "priceYearPaisa"] as const) {
      const from = prev.business[part][field], to = next.business[part][field];
      if (from === to) continue;
      changes.push({ kind: to > from ? "price_rise" : "price_cut", appId: null, editionId: null, addonKey: part, what: `${label} add-on ${field === "priceMonthPaisa" ? "monthly" : "yearly"} price ${rupees(from)} -> ${rupees(to)}`, from, to, paying: counts.businessAddons, free: 0 });
    }
  }
  const needs = changes.filter((c) => (c.kind === "price_rise" || c.kind === "paid_limit_cut") && c.paying > 0);
  return { changes, refused, needsApproval: needs.length > 0, payingAffected: needs.reduce((a, c) => a + c.paying, 0) };
}
