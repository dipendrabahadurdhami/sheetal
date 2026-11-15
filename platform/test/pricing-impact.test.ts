// pricingImpact() and sellerSnapshot(): what a catalog change does to businesses that already have the apps, and what an invoice keeps of
// Sheetal's company details (P3-BE-7). Pure: no database.
import { describe, expect, it } from "vitest";
import { CATALOG_SETTING, withNewApps } from "../src/billing/catalog.js";
import { pricingImpact, type ImpactCounts } from "../src/billing/pricing-impact.js";
import { COMPANY_DEFAULT, sellerSnapshot } from "../src/billing/company.js";
import type { Catalog } from "../src/billing/types.js";

const base = (): Catalog => structuredClone(withNewApps(CATALOG_SETTING.default));
const counts = (paying: number, free = 0, trialing = 0): ImpactCounts => ({ editions: { "agreements:full": { paying, trialing, free: 0 }, "agreements:free": { paying: 0, trialing: 0, free } }, addons: { listings_pack: paying }, businessAddons: 0 });

describe("pricingImpact", () => {
  it("a price rise with paying businesses needs approval; without them it does not", () => {
    const next = base(); next.apps.agreements!.editions.full!.priceMonthPaisa = 25_000;
    const a = pricingImpact(base(), next, counts(3));
    expect(a.needsApproval).toBe(true);
    expect(a.payingAffected).toBe(3);
    expect(a.changes).toEqual([expect.objectContaining({ kind: "price_rise", appId: "agreements", editionId: "full", from: 20_000, to: 25_000, paying: 3 })]);
    expect(pricingImpact(base(), next, counts(0)).needsApproval).toBe(false);
  });

  it("a price cut never needs approval", () => {
    const next = base(); next.apps.agreements!.editions.full!.priceYearPaisa = 150_000;
    const a = pricingImpact(base(), next, counts(9));
    expect(a.changes[0]!.kind).toBe("price_cut");
    expect(a.needsApproval).toBe(false);
  });

  it("a cut of a paid limit with paying businesses needs approval; a cut of a free limit is only shown", () => {
    const paid = base(); paid.apps.agreements!.editions.full!.limits.agreements_per_month = { value: 50, behaviour: "hard" };
    const a = pricingImpact(base(), paid, counts(2));
    expect(a.changes[0]).toMatchObject({ kind: "paid_limit_cut", paying: 2 });
    expect(a.needsApproval).toBe(true);
    const free = base(); free.apps.agreements!.editions.free!.limits.agreements_per_month = { value: 1, behaviour: "hard" };
    const b = pricingImpact(base(), free, counts(2, 40));
    expect(b.changes[0]).toMatchObject({ kind: "free_limit_cut", free: 40 });
    expect(b.needsApproval).toBe(false);
  });

  it("refuses to turn off what businesses use, but allows hiding from new sales", () => {
    const off = base(); off.apps.agreements!.freeEditionEnabled = false;
    expect(pricingImpact(base(), off, counts(0, 5)).refused[0]).toMatch(/5 businesses use the free edition/);
    expect(pricingImpact(base(), off, counts(0, 0)).refused).toEqual([]);
    const soon = base(); soon.apps.agreements!.availability = "coming_soon";
    expect(pricingImpact(base(), soon, counts(1)).refused[0]).toMatch(/can't go back to "coming soon"/);
    const hidden = base(); hidden.apps.agreements!.visible = false;
    const h = pricingImpact(base(), hidden, counts(4));
    expect(h.refused).toEqual([]);
    expect(h.changes[0]!.kind).toBe("hidden");
  });

  it("an add-on price rise counts the businesses that have the add-on", () => {
    const next = base(); next.addons[0]!.priceMonthPaisa += 5_000;
    const a = pricingImpact(base(), next, counts(2));
    expect(a.changes[0]).toMatchObject({ kind: "price_rise", addonKey: "listings_pack", paying: 2 });
    expect(a.needsApproval).toBe(true);
  });

  it("no change, no changes", () => {
    expect(pricingImpact(base(), base(), counts(5))).toEqual({ changes: [], refused: [], needsApproval: false, payingAffected: 0 });
  });
});

describe("sellerSnapshot", () => {
  it("keeps only the site name until the details are entered", () => {
    expect(sellerSnapshot(COMPANY_DEFAULT, "Sheetal Property")).toEqual({ name: "Sheetal Property" });
  });
  it("keeps the details that were filled in", () => {
    expect(sellerSnapshot({ ...COMPANY_DEFAULT, tradeName: "Sheetal", legalName: "Sheetal Pvt Ltd", pan: "123456789", vatRegistered: true, address: "Kathmandu" }, "x"))
      .toEqual({ name: "Sheetal", legalName: "Sheetal Pvt Ltd", pan: "123456789", vatRegistered: true, address: "Kathmandu" });
  });
});
