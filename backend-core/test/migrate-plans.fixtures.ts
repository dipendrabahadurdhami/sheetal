// Fixtures for the plan-to-apps migration tests (P3-BE-10, suite 12 of PHASE-3-TEST-PLAN.md): the QA-1 businesses (every type × Starter /
// Business / Pro, add-ons, trial, past due, suspended) as the pure planner sees them, plus the cases only the migration has (covered,
// cancelled, demo, a payment in flight, usage above the new free limits, 3/6/12-month periods).
// Where it fits: backend-core/test/migrate-plans.test.ts.
// Rules: data only. Prices and limits come from the real seed (domain/plans.ts, domain/addons.ts), so a change there shows up here.
import type { MigrationBusiness } from "@sheetal/platform/billing/migrate-plan";
import { ADDON_DEFAULTS } from "../src/domain/addons.js";
import { PLANS, priceFor } from "../src/domain/plans.js";
import { AI_CREDITS } from "../src/lib/ai.js";
import { P3_BUSINESSES, limitsOf, type P3Business } from "./fixtures/p3-businesses.js";

export const NOW = new Date("2026-11-20T06:00:00Z");
export const RENEWS = new Date("2026-12-05T00:00:00Z");

const addonOf = (oldKey: string) => ADDON_DEFAULTS.find((a) => a.limitKey === oldKey)!;

/** A QA-1 fixture as the planner's input. */
export function fromP3(f: P3Business, over: Partial<MigrationBusiness> = {}): MigrationBusiness {
  const addons = Object.entries(f.extra).flatMap(([k, n]) => {
    const a = ADDON_DEFAULTS.find((x) => x.limitKey === k);
    return a ? [{ id: a.id, qty: n / a.step, renewQty: n / a.step, priceMonth: a.price }] : [];
  });
  // Rooms are not sold as an add-on (only seats, listings, featured, outlets): the "10 more rooms" of the fixture count as a raised limit only.
  const period = over.period ?? 1;
  const paid = f.plan.price > 0;
  return {
    id: f.name.replace(/\W+/g, "-"), name: f.name, type: f.type, status: f.status, demo: f.status === "demo", period,
    renewsAt: paid || f.status === "trial" ? RENEWS : null,
    graceUntil: f.status === "past_due" ? new Date("2026-11-25T00:00:00Z") : null,
    coveredById: null,
    plan: { id: f.plan.id, name: f.plan.name, price: f.plan.price, limits: f.plan.limits, features: f.plan.features },
    limits: limitsOf(f), addons,
    oldRenewalRupees: paid ? priceFor(f.plan.price, period) + addons.reduce((s, a) => s + a.renewQty * a.priceMonth * period, 0) : 0,
    usage: {}, aiCreditsMonthly: AI_CREDITS[f.plan.name] ?? 0, openInvoices: [], paymentsInFlight: 0,
    ...over,
  };
}

export const ALL = P3_BUSINESSES.map((f) => fromP3(f));
const by = (n: string) => P3_BUSINESSES.find((b) => b.name === n)!;

/** The cases the migration adds. */
export const EXTRA: { name: string; b: MigrationBusiness }[] = [
  { name: "agency Business, 3 months", b: fromP3(by("agency Business"), { id: "agency-3mo", period: 3 }) },
  { name: "hotel Pro, 12 months", b: fromP3(by("hotel Pro"), { id: "hotel-12mo", period: 12 }) },
  { name: "agency Business with 2 listing packs and 1 seat", b: (() => {
    const f = by("agency Business");
    const b = fromP3(f, { id: "agency-addons" });
    b.addons = [{ id: "listings", qty: 2, renewQty: 2, priceMonth: addonOf("listings").price }, { id: "seats", qty: 1, renewQty: 1, priceMonth: addonOf("seats").price }];
    b.limits = { ...f.plan.limits, listings: f.plan.limits.listings! + 50, seats: f.plan.limits.seats! + 1 };
    b.oldRenewalRupees = priceFor(f.plan.price, 1) + 2 * addonOf("listings").price + addonOf("seats").price;
    return b;
  })() },
  { name: "agency Starter already over the new free limits", b: fromP3(by("agency Starter"), { id: "agency-over", usage: { "listings.listings": 4, "crm.leads": 250, "invoicing.invoices_per_month": 30 } }) },
  { name: "host Pro covered by another business", b: fromP3(by("host Pro"), { id: "host-covered", coveredById: "hotel-12mo", parentRenewsAt: RENEWS, oldRenewalRupees: 0 }) },
  { name: "developer Business past due with a long old grace", b: fromP3(by("developer Business past due"), { id: "dev-long-grace", renewsAt: new Date("2026-11-15T00:00:00Z"), graceUntil: new Date("2026-12-10T00:00:00Z") }) },
];

/** Never written, always listed. */
export const SKIPPED: { name: string; b: MigrationBusiness; reason: RegExp }[] = [
  { name: "suspended", b: fromP3(by("sponsor Business suspended (skipped by the migration)")), reason: /suspended/ },
  { name: "cancelled", b: fromP3(by("agency Business"), { id: "c", status: "cancelled" }), reason: /cancelled/ },
  { name: "demo", b: fromP3(by("agency Business"), { id: "d", demo: true }), reason: /demo/ },
  { name: "payment in flight", b: fromP3(by("agency Business"), { id: "f", paymentsInFlight: 1 }), reason: /in flight/ },
  { name: "unknown plan", b: fromP3(by("agency Business"), { id: "u", plan: { id: "agency-gold", name: "Gold" as never, price: 900, limits: {}, features: {} } }), reason: /P8: unknown plan/ },
  { name: "unknown type", b: fromP3(by("agency Business"), { id: "t", type: "farm" }), reason: /P8: unknown business type/ },
  { name: "unknown add-on", b: fromP3(by("agency Business"), { id: "a", addons: [{ id: "parking", qty: 1, renewQty: 1, priceMonth: null }] }), reason: /P8: unknown add-on/ },
  { name: "paid without a renewal date", b: fromP3(by("agency Business"), { id: "r", renewsAt: null }), reason: /P4/ },
];

export { PLANS };
