// Software packs (src/billing/packs.ts): prices, the offer, the grouping, the invoice lines and the guard.
import { describe, expect, it } from "vitest";
import { CatalogSchema, catalogProblems, seedCatalog, withNewApps } from "../src/billing/catalog.js";
import { SEED_PACKS, SOFTWARE, packApps, packPrice, packProblems, packQuote, publicPacks } from "../src/billing/packs.js";
import { BILLING_DEFAULTS, type BillingState, type Catalog } from "../src/billing/types.js";

const S = { ...BILLING_DEFAULTS, salesEnabled: true };
const now = new Date("2026-11-27T06:00:00Z");
const empty: BillingState = { anchorDay: null, subscriptions: [], lock: null };

describe("the first packs", () => {
  it("have the owner's prices: 6 months saves 10%, a year 20%, and the launch offer", () => {
    expect(SEED_PACKS.starter!.prices).toEqual({ m1: 499_900, m6: 2_699_900, m12: 4_799_900 });
    expect(SEED_PACKS.business!.prices).toEqual({ m1: 999_900, m6: 5_399_900, m12: 9_599_900 });
    expect(SEED_PACKS.pro!.prices).toEqual({ m1: 1_499_900, m6: 8_099_900, m12: 14_399_900 });
    expect(SEED_PACKS.starter!.offer.prices.m1).toBe(399_900);
    expect(SEED_PACKS.business!.offer.prices.m1).toBe(899_900);
    expect(SEED_PACKS.pro!.offer.prices.m1).toBe(1_399_900);
    expect(packPrice(SEED_PACKS.pro!, 1)).toEqual({ pricePaisa: 1_399_900, normalPaisa: 1_499_900, onOffer: true });
    expect(packPrice({ ...SEED_PACKS.pro!, offer: { ...SEED_PACKS.pro!.offer, enabled: false } }, 12)).toEqual({ pricePaisa: 14_399_900, normalPaisa: 14_399_900, onOffer: false });
  });

  it("group the apps into software, each app in one software only, and Pro has every software", () => {
    const all = SOFTWARE.flatMap((s) => s.apps);
    expect(new Set(all).size).toBe(all.length);
    expect(SEED_PACKS.pro!.software).toEqual(SOFTWARE.map((s) => s.id));
    expect(packApps(SEED_PACKS.starter!)).toEqual(expect.arrayContaining(["listings", "reviews", "crm", "invoicing"]));
    expect(packApps(SEED_PACKS.starter!)).not.toContain("people");
    expect(packApps(SEED_PACKS.business!)).toEqual(expect.arrayContaining(["people", "rentals", "agreements"]));
    // Every app of the grouping that exists in the catalog is in Pro.
    const cat = seedCatalog();
    for (const a of all) if (cat.apps[a]) expect(packApps(SEED_PACKS.pro!)).toContain(a);
  });
});

describe("a catalog saved before packs", () => {
  it("still fits and gets the first packs, without changing any saved value", () => {
    const saved = seedCatalog() as Catalog;
    delete saved.packs;
    saved.apps.listings!.editions.free!.limits.listings!.value = null; // the owner's free listings
    expect(CatalogSchema.safeParse(saved).success).toBe(true);
    const out = withNewApps(saved);
    expect(Object.keys(out.packs!)).toEqual(["starter", "business", "pro"]);
    expect(out.apps.listings!.editions.free!.limits.listings!.value).toBeNull();
    // Saved packs are kept as they are.
    const mine = withNewApps({ ...out, packs: { starter: { ...out.packs!.starter!, prices: { m1: 100_000, m6: 500_000, m12: 900_000 } } } });
    expect(mine.packs!.starter!.prices.m1).toBe(100_000);
    expect(mine.packs!.business).toBeUndefined();
  });
});

describe("buying a pack", () => {
  const cat = withNewApps(seedCatalog());

  it("is one line per live app, adding up to the pack price exactly, with VAT split once", () => {
    for (const [packId, months] of [["starter", 1], ["business", 6], ["pro", 12]] as const) {
      const q = packQuote({ now, business: empty, catalog: cat, settings: S, packId, months });
      expect(q.errors).toEqual([]);
      const want = packPrice(cat.packs![packId]!, months).pricePaisa;
      expect(q.totalPaisa).toBe(want);
      expect(q.lines.reduce((a, l) => a + l.grossPaisa, 0)).toBe(want);
      expect(q.lines.reduce((a, l) => a + l.vatPaisa, 0)).toBe(q.vatPaisa);
      expect(q.subtotalPaisa + q.vatPaisa).toBe(want);
      for (const l of q.lines) {
        expect(l).toMatchObject({ kind: "subscription", saleType: "new", periodMonths: months });
        expect(l.unitGrossPaisa).toBe(l.grossPaisa); // renewals charge each app its share again: the pack price
        expect(cat.apps[l.appId!]!.availability).toBe("live");
        expect((l.description as { packId?: string }).packId).toBe(packId);
      }
    }
  });

  it("runs 6 months to the same day, and lists apps still coming without charging them", () => {
    const q = packQuote({ now, business: empty, catalog: cat, settings: S, packId: "pro", months: 6 });
    const nepal = (d: Date) => new Date(d.getTime() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 10);
    expect(nepal(q.lines[0]!.periodEnd!)).toBe("2027-05-27");
    const coming = Object.entries(cat.apps).filter(([id, a]) => a.availability !== "live" && packApps(cat.packs!.pro!).includes(id)).length;
    expect(q.comingSoon.length).toBe(coming);
    if (coming) expect(q.notes[0]!.en).toMatch(/Coming soon/);
  });

  it("refuses an unknown pack, another length, and an app the business already pays for", () => {
    expect(packQuote({ now, business: empty, catalog: cat, settings: S, packId: "gold", months: 1 }).errors[0]!.en).toMatch(/doesn't exist/);
    expect(packQuote({ now, business: empty, catalog: cat, settings: S, packId: "pro", months: 3 }).errors[0]!.en).toMatch(/6 months or 1 year/);
    const paying: BillingState = { ...empty, subscriptions: [{ appId: "crm", editionId: "full", status: "active", periodMonths: 1, priceGrossPaisa: 100_000, currentPeriodStart: now, currentPeriodEnd: new Date("2026-12-20T00:00:00Z"), trialEndsAt: null, trialUsedAt: null, cancelAtPeriodEnd: false, uninstalledAt: null }] };
    expect(packQuote({ now, business: paying, catalog: cat, settings: S, packId: "starter", months: 1 }).errors[0]!.en).toMatch(/already pay for CRM/);
  });
});

describe("the guard and the public view", () => {
  it("refuses prices that make no sense", () => {
    const cat = withNewApps(seedCatalog());
    const bad = structuredClone(cat.packs!);
    bad.starter!.prices.m6 = bad.starter!.prices.m1 * 7;
    bad.business!.offer.prices.m1 = bad.business!.prices.m1;
    bad.pro!.software = ["cms", "spaceships"];
    const p = packProblems(bad, cat);
    expect(p.join(" ")).toMatch(/6-month price/);
    expect(p.join(" ")).toMatch(/offer price must be lower/);
    expect(p.join(" ")).toMatch(/spaceships/);
    expect(catalogProblems({ ...cat, packs: bad }).length).toBeGreaterThanOrEqual(3);
    expect(catalogProblems(cat)).toEqual([]);
  });

  it("shows packs with their three lengths and the software, nothing internal", () => {
    const v = publicPacks(withNewApps(seedCatalog()));
    expect(v.packs.map((p) => p.id)).toEqual(["starter", "business", "pro"]);
    expect(v.packs[1]!.highlight).toBe(true);
    expect(v.packs[0]!.periods.map((x) => x.months)).toEqual([1, 6, 12]);
    expect(v.packs[0]!.periods[0]).toMatchObject({ pricePaisa: 399_900, normalPaisa: 499_900, onOffer: true });
    expect(v.software.find((s) => s.id === "cms")!.free).toBe(true);
  });
});
