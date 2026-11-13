// Tests for the pure billing core (P3-BE-2): Nepal days, effective status and access, limits, proration, coupons, price protection and the
// quote (MARKETPLACE-AND-BILLING.md sections 4 to 7). Table rows come from proration.table.ts (P3-QA-1).
// Where it fits: platform/src/billing/*. No database and no clock: every test passes `now`.
// Run with: npm run test -w @sheetal/platform
import { describe, expect, it } from "vitest";
import { Money } from "../src/core/money.js";
import { addMonthsOnAnchor, nextAnchor, previousAnchor, nepalDays } from "../src/billing/days.js";
import { ACCESS_RULES, effectiveStatus, jobMayRun } from "../src/billing/effective-status.js";
import { checkLimit, largerLimit, readLimit } from "../src/billing/limits.js";
import { periodDays, share, upgrade } from "../src/billing/proration.js";
import { checkCoupon } from "../src/billing/coupon.js";
import { priceProtection } from "../src/billing/lock.js";
import { quote, type QuoteInput } from "../src/billing/quote.js";
import { BILLING_DEFAULTS, type BillingState, type Catalog, type CouponInput, type SubscriptionState } from "../src/billing/types.js";
import { ANCHOR_CASES, DAY_CASES, NPT, SHARE_CASES, UPGRADE_CASES, VAT_CASES } from "./proration.table.js";

const S = { ...BILLING_DEFAULTS, salesEnabled: true };
const lim = (value: number | null, behaviour: "hard" | "soft" = "hard") => ({ value, behaviour });
const CATALOG: Catalog = {
  version: 1,
  periods: [1, 12],
  business: { freeSeats: 2, seatAddon: { priceMonthPaisa: 20_000, priceYearPaisa: 200_000 }, storageAddon: { unitMb: 1024, priceMonthPaisa: 10_000, priceYearPaisa: 100_000 }, paidFeatures: ["branding.custom"] },
  apps: {
    listings: { name: { en: "Listings" }, availability: "live", visible: true, freeEditionEnabled: true, trialDays: 14, editions: {
      free: { name: { en: "Free" }, free: true, priceMonthPaisa: 0, priceYearPaisa: 0, limits: { listings: lim(3) }, features: [], sort: 0 },
      full: { name: { en: "Full" }, free: false, priceMonthPaisa: 40_000, priceYearPaisa: 400_000, limits: { listings: lim(500) }, features: ["listings.checkups"], sort: 1 },
      pro: { name: { en: "Pro" }, free: false, priceMonthPaisa: 70_000, priceYearPaisa: 700_000, limits: { listings: lim(null) }, features: ["listings.checkups"], sort: 2 },
    } },
    rentals: { name: { en: "Rentals" }, availability: "live", visible: true, freeEditionEnabled: true, trialDays: 14, editions: {
      free: { name: { en: "Free" }, free: true, priceMonthPaisa: 0, priceYearPaisa: 0, limits: { leases: lim(5) }, features: [], sort: 0 },
      full: { name: { en: "Full" }, free: false, priceMonthPaisa: 30_000, priceYearPaisa: 300_000, limits: { leases: lim(null) }, features: [], sort: 1 },
    } },
    payroll: { name: { en: "Payroll" }, availability: "coming_soon", visible: true, freeEditionEnabled: false, trialDays: null, editions: {
      full: { name: { en: "Full" }, free: false, priceMonthPaisa: 40_000, priceYearPaisa: 400_000, limits: {}, features: [], sort: 1 },
    } },
  },
  addons: [{ key: "listings_pack", appId: "listings", name: { en: "+25 listings" }, limitKey: "listings", step: 25, priceMonthPaisa: 30_000, priceYearPaisa: 300_000, needsPaidEdition: true, active: true }],
};

const sub = (o: Partial<SubscriptionState> & { appId: string }): SubscriptionState => ({
  editionId: "full", status: "active", periodMonths: 1, priceGrossPaisa: 40_000, currentPeriodStart: NPT("2026-11-01"), currentPeriodEnd: NPT("2026-12-01"),
  trialEndsAt: null, trialUsedAt: null, cancelAtPeriodEnd: false, uninstalledAt: null, ...o,
});
const biz = (o: Partial<BillingState> = {}): BillingState => ({ anchorDay: null, subscriptions: [], lock: null, ...o });
const q = (o: Partial<QuoteInput> & Pick<QuoteInput, "items">) => quote({ now: new Date("2026-11-19T05:00:00Z"), business: biz(), catalog: CATALOG, settings: S, ...o });
const COUPON = (o: Partial<CouponInput> = {}): CouponInput => ({ code: "LAUNCH20", kind: "percent", value: 20, appliesTo: "all", appIds: [], editionIds: [], firstPurchaseOnly: false, minSpendPaisa: null, validFrom: null, validTo: null, maxRedemptions: null, perBusinessLimit: 1, active: true, ...o });

/** Every quote must add up: line net + VAT = gross, lines sum to the totals, subtotal + VAT = total, nothing negative due. */
function addsUp(r: ReturnType<typeof quote>) {
  for (const l of r.lines) expect(l.netPaisa + l.vatPaisa).toBe(l.grossPaisa);
  expect(r.lines.reduce((a, l) => a + l.grossPaisa, 0)).toBe(r.totalPaisa);
  expect(r.lines.reduce((a, l) => a + l.vatPaisa, 0)).toBe(r.vatPaisa);
  expect(r.subtotalPaisa + r.vatPaisa).toBe(r.totalPaisa);
  expect(r.totalPaisa).toBeGreaterThanOrEqual(0);
}

describe("the proration table (P3-QA-1)", () => {
  it.each(SHARE_CASES)("share: $name", (c) => expect(share(Money.paisa(c.price), c.left, c.total).paisa).toBe(c.want));
  it.each(UPGRADE_CASES)("upgrade: $name", (c) => {
    const u = upgrade(Money.paisa(c.old), Money.paisa(c.next), c.left, c.total);
    expect({ credit: u.credit.paisa, charge: u.charge.paisa, due: u.due.paisa }).toEqual(c.want);
  });
  it.each(VAT_CASES)("VAT inside the price: $name", (c) => {
    const v = Money.paisa(c.total).splitVat(13);
    expect({ subtotal: v.subtotal.paisa, vat: v.vat.paisa }).toEqual(c.want);
  });
  it.each(DAY_CASES)("Nepal days: $name", (c) => expect(periodDays(c.now, c.start, c.end)).toEqual(c.want));
  it.each(ANCHOR_CASES)("anchor: $name", (c) => {
    const got = c.fn === "next" ? nextAnchor(c.at, c.anchor) : c.fn === "previous" ? previousAnchor(c.at, c.anchor) : addMonthsOnAnchor(c.at, c.months!, c.anchor);
    expect(got.toISOString()).toBe(c.want.toISOString());
  });
  it("counts Nepal days, not UTC days", () => {
    // 18:00 and 18:30 UTC on the same UTC day are different Nepal days.
    expect(nepalDays(new Date("2026-11-13T18:00:00Z"), new Date("2026-11-13T18:30:00Z"))).toBe(1);
    expect(nepalDays(new Date("2026-11-13T00:00:00Z"), new Date("2026-11-13T18:00:00Z"))).toBe(0);
  });
});

describe("effective status: dates decide (MB 5.1, 5.5)", () => {
  const settings = S;
  const at = (iso: string) => new Date(iso);
  const paid = sub({ appId: "listings" }); // paid until Nepal 1 Dec 2026
  it("a free edition is active and full forever", () => {
    expect(effectiveStatus(sub({ appId: "listings", editionId: "free", periodMonths: null, priceGrossPaisa: 0, currentPeriodEnd: null }), at("2030-01-01T00:00:00Z"), { freeEditionEnabled: true, settings }))
      .toMatchObject({ status: "active", access: "full", edition: "free" });
  });
  it("a trial is full until it ends, then falls to the free edition, or locks a paid-only app", () => {
    const trial = sub({ appId: "listings", status: "trialing", periodMonths: null, currentPeriodEnd: null, trialEndsAt: NPT("2026-11-28") });
    expect(effectiveStatus(trial, at("2026-11-27T12:00:00Z"), { freeEditionEnabled: true, settings })).toMatchObject({ status: "trialing", access: "full", edition: "full" });
    expect(effectiveStatus(trial, NPT("2026-11-28"), { freeEditionEnabled: true, settings })).toMatchObject({ status: "expired", access: "limited", edition: "free" });
    expect(effectiveStatus(trial, NPT("2026-11-28"), { freeEditionEnabled: false, settings })).toMatchObject({ status: "expired", access: "locked", edition: null });
  });
  it("walks the unpaid renewal timeline: active, past due (day 0 to 6), then free edition or read-only, then locked at day 67", () => {
    const free = { freeEditionEnabled: true, settings };
    const paidOnly = { freeEditionEnabled: false, settings };
    expect(effectiveStatus(paid, at("2026-11-30T18:14:59Z"), free)).toMatchObject({ status: "active", access: "full" }); // one second before Nepal midnight
    expect(effectiveStatus(paid, NPT("2026-12-01"), free)).toMatchObject({ status: "past_due", access: "full", edition: "full", until: NPT("2026-12-08") });
    expect(effectiveStatus(paid, at("2026-12-07T18:00:00Z"), free)).toMatchObject({ status: "past_due", access: "full" }); // 23:45 on 7 Dec in Nepal: the last grace day
    expect(effectiveStatus(paid, NPT("2026-12-08"), free)).toMatchObject({ status: "expired", access: "limited", edition: "free" });
    expect(effectiveStatus(paid, NPT("2026-12-08"), paidOnly)).toMatchObject({ status: "read_only", access: "read_only", until: NPT("2027-02-06") });
    expect(effectiveStatus(paid, NPT("2027-02-05"), paidOnly)).toMatchObject({ status: "read_only" });
    expect(effectiveStatus(paid, NPT("2027-02-06"), paidOnly)).toMatchObject({ status: "expired", access: "locked" });
  });
  it("a cancelled subscription keeps full access to its period end, then falls back without grace", () => {
    const c = sub({ appId: "listings", status: "cancelled" });
    expect(effectiveStatus(c, NPT("2026-11-30"), { freeEditionEnabled: true, settings })).toMatchObject({ status: "cancelled", access: "full" });
    expect(effectiveStatus(c, NPT("2026-12-01"), { freeEditionEnabled: true, settings })).toMatchObject({ status: "expired", access: "limited" });
    expect(effectiveStatus(sub({ appId: "listings", cancelAtPeriodEnd: true }), NPT("2026-12-01"), { freeEditionEnabled: false, settings })).toMatchObject({ access: "locked" });
  });
  it("an uninstalled app is none; the stored status never decides (a stale 'active' past its dates is still past due)", () => {
    expect(effectiveStatus(sub({ appId: "listings", uninstalledAt: NPT("2026-11-02") }), NPT("2026-11-03"), { freeEditionEnabled: true, settings }).access).toBe("none");
    expect(effectiveStatus(sub({ appId: "listings", status: "active" }), NPT("2026-12-03"), { freeEditionEnabled: true, settings }).status).toBe("past_due");
  });
  it("access modes allow what MB 7.2 says, and jobs run only for full or limited", () => {
    expect(ACCESS_RULES.read_only).toEqual({ read: true, edit: false, create: false, publicLeads: true, paidBookings: false });
    expect(ACCESS_RULES.locked.read).toBe(false);
    expect(ACCESS_RULES.limited.create).toBe(true);
    expect(["full", "limited", "read_only", "locked", "none"].map((a) => jobMayRun(a as never))).toEqual([true, true, false, false, false]);
  });
});

describe("limits (MB 6.3, Q1)", () => {
  it("hard: the 5th room is fine, the 6th is refused; existing ones are never touched", () => {
    expect(checkLimit(lim(5), 4)).toMatchObject({ refused: false, over: false, warn: true });
    expect(checkLimit(lim(5), 5)).toMatchObject({ refused: true, over: true, ceiling: 5 });
    expect(checkLimit(lim(5), 9, 0)).toMatchObject({ refused: false }); // editing (adding nothing) is never refused
  });
  it("soft at 20%: 100 bills a month allow 120, the 121st is refused", () => {
    expect(checkLimit(lim(100, "soft"), 100)).toMatchObject({ refused: false, over: true, ceiling: 120 });
    expect(checkLimit(lim(100, "soft"), 119)).toMatchObject({ refused: false, over: true });
    expect(checkLimit(lim(100, "soft"), 120)).toMatchObject({ refused: true });
    expect(checkLimit({ value: 7, behaviour: "soft", softOverPct: 20 }, 7).ceiling).toBe(8);
  });
  it("warns from 80%, unlimited never warns, larger limit wins and null (unlimited) beats any number", () => {
    expect(checkLimit(lim(10), 6).warn).toBe(false);
    expect(checkLimit(lim(10), 7).warn).toBe(true);
    expect(checkLimit(lim(null), 1_000_000)).toEqual({ warn: false, over: false, refused: false, ceiling: null });
    expect(largerLimit(5, 25)).toBe(25);
    expect(largerLimit(5, null)).toBe(null);
    expect(largerLimit(undefined, 3)).toBe(3);
    expect(largerLimit(undefined, undefined)).toBe(undefined);
    expect([readLimit(-1), readLimit(4), readLimit(null), readLimit("x")]).toEqual([null, 4, null, undefined]);
  });
});

describe("the quote: the three worked examples (MB 5.3)", () => {
  it("example 1: upgrade Full Rs 400 to Pro Rs 700 with 12 of 30 days left: Rs 120 due, VAT Rs 13.81", () => {
    const r = q({ business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "change", appId: "listings", editionId: "pro", periodMonths: 1 }] });
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.kind, l.grossPaisa])).toEqual([["subscription", 28_000], ["proration_credit", -16_000]]);
    expect({ total: r.totalPaisa, vat: r.vatPaisa, subtotal: r.subtotalPaisa }).toEqual({ total: 12_000, vat: 1_381, subtotal: 10_619 });
    expect(r.lines[0]!.periodEnd!.toISOString()).toBe(NPT("2026-12-01").toISOString()); // dates do not change
    addsUp(r);
  });
  it("example 2: a Rs 300 app joins 14 days before the anchor in a 30-day cycle: Rs 140", () => {
    const r = q({ now: new Date("2026-11-17T05:00:00Z"), business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "subscribe", appId: "rentals", editionId: "full", periodMonths: 1 }] });
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ grossPaisa: 14_000, saleType: "new", periodMonths: 1 });
    expect(r.lines[0]!.periodEnd!.toISOString()).toBe(NPT("2026-12-01").toISOString());
    expect(r.anchorDay).toBe(1);
    addsUp(r);
  });
  it("example 3: 20% coupon on Rs 400: Rs 320, VAT Rs 36.81", () => {
    const r = q({ business: biz(), items: [{ kind: "subscribe", appId: "listings", editionId: "full", periodMonths: 1 }], coupon: COUPON() });
    expect(r.errors).toEqual([]);
    expect({ total: r.totalPaisa, discount: r.discountPaisa, vat: r.vatPaisa, subtotal: r.subtotalPaisa }).toEqual({ total: 32_000, discount: 8_000, vat: 3_681, subtotal: 28_319 });
    expect(r.lines[0]).toMatchObject({ unitGrossPaisa: 40_000, discountPaisa: 8_000, grossPaisa: 32_000 });
    addsUp(r);
  });
});

describe("the quote: rules", () => {
  it("the first paid monthly app is full price and today becomes the anchor (at most the 28th); yearly keeps its own anniversary", () => {
    const r = q({ now: new Date("2026-11-30T05:00:00Z"), items: [{ kind: "subscribe", appId: "listings", editionId: "full", periodMonths: 1 }, { kind: "subscribe", appId: "rentals", editionId: "full", periodMonths: 12 }] });
    expect(r.errors).toEqual([]);
    expect(r.anchorDay).toBe(28);
    expect(r.lines.map((l) => [l.appId, l.grossPaisa, l.periodEnd!.toISOString()])).toEqual([
      ["listings", 40_000, NPT("2026-12-28").toISOString()],
      ["rentals", 300_000, NPT("2027-11-28").toISOString()],
    ]);
    expect(r.totalPaisa).toBe(340_000);
    addsUp(r);
  });
  it("a new app with fewer than 5 days to the anchor runs to the following anchor", () => {
    const r = q({ now: new Date("2026-11-28T05:00:00Z"), business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "subscribe", appId: "rentals", editionId: "full", periodMonths: 1 }] });
    // 3 days left of November + the 31 days of December, over December's 31: Rs 300 × 34 / 31 = 32,903.23 -> 32,903 paisa.
    expect(r.lines[0]).toMatchObject({ grossPaisa: 32_903 });
    expect(r.lines[0]!.periodEnd!.toISOString()).toBe(NPT("2027-01-01").toISOString());
  });
  it("refuses what can't be sold: free editions, coming-soon apps, a second purchase of a paid app, unknown add-ons, bad periods, doubles", () => {
    const paying = biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] });
    const errs = (items: QuoteInput["items"], business = biz()) => q({ items, business }).errors.map((e) => e.en);
    expect(errs([{ kind: "subscribe", appId: "listings", editionId: "free", periodMonths: 1 }])[0]).toMatch(/is free: install it/);
    expect(errs([{ kind: "subscribe", appId: "payroll", editionId: "full", periodMonths: 1 }])[0]).toMatch(/coming soon/);
    expect(errs([{ kind: "subscribe", appId: "listings", editionId: "pro", periodMonths: 1 }], paying)[0]).toMatch(/already pay/);
    expect(errs([{ kind: "subscribe", appId: "listings", editionId: "full", periodMonths: 3 }])[0]).toMatch(/monthly or yearly/);
    expect(errs([{ kind: "addon", addonKey: "rockets", qty: 1 }])[0]).toMatch(/isn't sold/);
    expect(errs([{ kind: "addon", addonKey: "listings_pack", qty: 1 }])[0]).toMatch(/needs a paid Listings/);
    expect(errs([{ kind: "subscribe", appId: "rentals", editionId: "full", periodMonths: 1 }, { kind: "subscribe", appId: "rentals", editionId: "full", periodMonths: 12 }])[0]).toMatch(/twice/);
    expect(errs([])[0]).toMatch(/empty/);
  });
  it("downgrades and year-to-month wait for the period end with nothing to pay", () => {
    const r = q({ business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings", editionId: "pro", priceGrossPaisa: 70_000 })] }), items: [{ kind: "change", appId: "listings", editionId: "full", periodMonths: 1 }] });
    expect(r.lines).toEqual([]);
    expect(r.totalPaisa).toBe(0);
    expect(r.notes[0]!.en).toMatch(/moves to Full on 2026-12-01/);
  });
  it("month to year: the unused month is credited and the year starts today", () => {
    const r = q({ business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "change", appId: "listings", editionId: "full", periodMonths: 12 }] });
    expect(r.lines.map((l) => [l.kind, l.grossPaisa])).toEqual([["subscription", 400_000], ["proration_credit", -16_000]]);
    expect(r.lines[0]!.periodEnd!.toISOString()).toBe(NPT("2027-11-19").toISOString());
    addsUp(r);
  });
  it("renewing in grace continues from the old end date (no gap, no double); after the grace it starts today", () => {
    const b = biz({ anchorDay: 1, subscriptions: [sub({ appId: "rentals", editionId: "full", priceGrossPaisa: 30_000 })] });
    const inGrace = q({ now: NPT("2026-12-05"), business: b, items: [{ kind: "renew", appId: "rentals" }] });
    expect(inGrace.lines[0]).toMatchObject({ grossPaisa: 30_000, saleType: "renewal" });
    expect([inGrace.lines[0]!.periodStart!.toISOString(), inGrace.lines[0]!.periodEnd!.toISOString()]).toEqual([NPT("2026-12-01").toISOString(), NPT("2027-01-01").toISOString()]);
    const late = q({ now: NPT("2026-12-20"), business: b, items: [{ kind: "renew", appId: "rentals" }] });
    expect(late.lines[0]!.periodStart!.toISOString()).toBe(NPT("2026-12-20").toISOString());
  });
  it("price protection: a covered renewal costs no more than the old plan, with a visible line; after the lock it stops", () => {
    const lock = { legacyMonthlyGrossPaisa: 50_000, legacyPeriodMonths: 1, coversApps: ["listings", "rentals"], lockEnd: NPT("2027-12-01") };
    const subs = [sub({ appId: "listings" }), sub({ appId: "rentals", priceGrossPaisa: 30_000 })];
    const r = q({ now: NPT("2026-11-28"), business: biz({ anchorDay: 1, subscriptions: subs, lock }), items: [{ kind: "renew", appId: "listings" }, { kind: "renew", appId: "rentals" }] });
    expect(r.lines.map((l) => [l.kind, l.grossPaisa])).toEqual([["subscription", 40_000], ["subscription", 30_000], ["price_protection", -20_000]]);
    expect(r.totalPaisa).toBe(50_000);
    expect(r.lines[2]!.description.en).toBe("Price protection until 2027-12-01");
    addsUp(r);
    const after = q({ now: NPT("2027-12-02"), business: biz({ anchorDay: 1, subscriptions: subs.map((s) => ({ ...s, currentPeriodEnd: NPT("2027-12-05") })), lock }), items: [{ kind: "renew", appId: "listings" }] });
    expect(after.lines.some((l) => l.kind === "price_protection")).toBe(false);
    expect(priceProtection(lock, NPT("2026-11-28"), Money.paisa(40_000), 1).paisa).toBe(0); // cheaper than the old plan: nothing to take off
    expect(priceProtection(lock, NPT("2026-11-28"), Money.paisa(160_000), 3, Money.paisa(130_000)).paisa).toBe(30_000); // the old multi-month price
  });
  it("an add-on mid-period is prorated to the parent's period end", () => {
    const r = q({ business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "addon", addonKey: "listings_pack", qty: 2 }] });
    expect(r.lines[0]).toMatchObject({ kind: "addon", qty: 2, unitGrossPaisa: 30_000, grossPaisa: 24_000 }); // 60,000 × 12 / 30
    const seats = q({ business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "addon", addonKey: "seats", qty: 1 }] });
    expect(seats.lines[0]).toMatchObject({ grossPaisa: 8_000, periodEnd: NPT("2026-12-01") }); // Rs 200 × 12 / 30
  });
  it("a total below the minimum charge moves to the next invoice", () => {
    const r = q({ now: NPT("2026-11-30"), business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "change", appId: "listings", editionId: "pro", periodMonths: 1 }] });
    // 1 of 30 days: 70,000/30 - 40,000/30 = 2,333 - 1,333 = 1,000 paisa = Rs 10, exactly the minimum: charged.
    expect(r.totalPaisa).toBe(1_000);
    const small = q({ now: NPT("2026-11-30"), settings: { ...S, minChargePaisa: 1_500 }, business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "change", appId: "listings", editionId: "pro", periodMonths: 1 }] });
    expect({ total: small.totalPaisa, carry: small.carryPaisa }).toEqual({ total: 0, carry: 1_000 });
    addsUp(small);
  });
  it("coupons: one per business, dates, minimum spend, only the apps named, never below zero", () => {
    const one = { kind: "subscribe" as const, appId: "listings", editionId: "full", periodMonths: 1 };
    expect(q({ items: [one], coupon: COUPON(), business: biz({ couponUsesByBusiness: 1 }) }).errors[0]!.en).toMatch(/already used/);
    expect(q({ items: [one], coupon: COUPON({ validTo: NPT("2026-11-01") }) }).errors[0]!.en).toMatch(/ended/);
    expect(q({ items: [one], coupon: COUPON({ minSpendPaisa: 50_000 }) }).errors[0]!.en).toMatch(/at least Rs 500.00/);
    expect(q({ items: [one], coupon: COUPON({ appliesTo: "apps", appIds: ["rentals"] }) }).errors[0]!.en).toMatch(/doesn't apply/);
    const big = q({ items: [one], coupon: COUPON({ kind: "fixed_paisa", value: 1_000_000 }) });
    expect(big.totalPaisa).toBe(0);
    addsUp(big);
    const two = q({ items: [one, { kind: "subscribe", appId: "rentals", editionId: "full", periodMonths: 1 }], coupon: COUPON({ appliesTo: "apps", appIds: ["rentals"] }) });
    expect(two.lines.map((l) => l.discountPaisa)).toEqual([0, 6_000]);
    expect(checkCoupon(COUPON({ firstPurchaseOnly: true }), { now: new Date(), firstPurchase: false, usesByBusiness: 0, usesTotal: 0, eligibleGrossPaisa: 1 })!.en).toMatch(/first purchase/);
    expect(checkCoupon(COUPON({ maxRedemptions: 10 }), { now: new Date(), firstPurchase: true, usesByBusiness: 0, usesTotal: 10, eligibleGrossPaisa: 1 })!.en).toMatch(/used up/);
  });
  it("is the same when run twice, and every random cart adds up with nothing negative due", () => {
    const input = { business: biz({ anchorDay: 1, subscriptions: [sub({ appId: "listings" })] }), items: [{ kind: "change" as const, appId: "listings", editionId: "pro", periodMonths: 1 }] };
    expect(q(input)).toEqual(q(input));
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed % n; };
    for (let i = 0; i < 400; i++) {
      const now = new Date(NPT("2026-11-01").getTime() + rnd(29) * 86_400_000 + rnd(86_400_000));
      const subs = rnd(2) ? [sub({ appId: "listings", editionId: rnd(2) ? "full" : "pro", priceGrossPaisa: rnd(2) ? 40_000 : 70_000 })] : [];
      const items: QuoteInput["items"] = [];
      if (rnd(2)) items.push({ kind: "subscribe", appId: "rentals", editionId: "full", periodMonths: rnd(2) ? 1 : 12 });
      if (subs.length && rnd(2)) items.push({ kind: "change", appId: "listings", editionId: rnd(2) ? "pro" : "full", periodMonths: rnd(3) ? 1 : 12 });
      if (subs.length && rnd(2)) items.push({ kind: "addon", addonKey: rnd(2) ? "seats" : "listings_pack", qty: 1 + rnd(4) });
      if (!items.length) continue;
      const r = q({ now, business: biz({ anchorDay: subs.length ? 1 : null, subscriptions: subs }), items, coupon: rnd(3) ? null : COUPON({ value: 1 + rnd(100) }) });
      addsUp(r);
    }
  });
});
