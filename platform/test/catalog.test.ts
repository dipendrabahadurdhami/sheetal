// Tests for the catalog setting (P3-BE-1): the first value equals the manifests plus the seed prices, the guards of MB 3.3, a saved value is
// never overwritten by a release, and the public view carries public fields only.
// Run with: npm run test -w @sheetal/platform (pure: no database).
import { describe, expect, it } from "vitest";
import { APPS } from "../src/tenancy/apps.generated.js";
import { BILLING_SETTING, CATALOG_SETTING, CatalogSchema, appFromManifest, catalogProblems, publicCatalog, seedCatalog, withNewApps } from "../src/billing/catalog.js";
import { SEED_EXTRA_APPS, SEED_PRICES } from "../src/billing/catalog.seed.js";
import { settingProblems, settingOf } from "../src/settings/defs.js";
import type { Catalog } from "../src/billing/types.js";

const sellable = APPS.filter((m) => m.kind === "app");

describe("the first catalog", () => {
  it("has every sellable manifest, with the manifest's limits, features and trial days, and nothing for the workspace", () => {
    const cat = seedCatalog();
    expect(Object.keys(cat.apps).sort()).toEqual([...sellable.map((m) => m.id), ...Object.keys(SEED_EXTRA_APPS)].sort());
    for (const m of sellable) {
      const a = cat.apps[m.id]!;
      expect(a.trialDays).toBe(m.trialDays);
      for (const e of m.editions) {
        expect(Object.fromEntries(Object.entries(a.editions[e.id]!.limits).map(([k, l]) => [k, l.value]))).toEqual(e.limits);
        expect(a.editions[e.id]!.features).toEqual([...e.features]);
      }
    }
    expect(cat.apps.workspace).toBeUndefined();
  });
  it("prices every paid edition (VAT included; yearly = 10 months) and keeps free editions at 0", () => {
    const cat = seedCatalog();
    for (const m of sellable) for (const e of m.editions) {
      const c = cat.apps[m.id]!.editions[e.id]!;
      if (e.free) expect([c.priceMonthPaisa, c.priceYearPaisa]).toEqual([0, 0]);
      else {
        expect(SEED_PRICES[m.id]?.[e.id], `${m.id} ${e.id} needs a seed price`).toBeDefined();
        expect(c.priceMonthPaisa).toBeGreaterThan(0);
        expect(c.priceYearPaisa).toBe(c.priceMonthPaisa * 10);
      }
    }
    expect(cat.apps.hotel!.editions.full!.priceMonthPaisa).toBe(70_000);
    expect(cat.apps.pos!.editions.free!.limits.bills_per_month).toEqual({ value: 100, behaviour: "soft" }); // money-in is soft (Q1)
    expect(cat.apps.hotel!.editions.free!.limits.rooms).toEqual({ value: 5, behaviour: "hard" });
  });
  it("passes its own schema and guards; the settings list has no problems", () => {
    expect(CatalogSchema.safeParse(seedCatalog()).success).toBe(true);
    expect(catalogProblems(seedCatalog())).toEqual([]);
    expect(settingProblems()).toEqual([]);
    expect(settingOf("platform.catalog")).toBe(CATALOG_SETTING);
    expect(settingOf("platform.billing")).toBe(BILLING_SETTING);
    expect(CATALOG_SETTING).toMatchObject({ write: "platform.pricing.manage", needsReason: true });
  });
});

describe("guards (MB 3.3)", () => {
  const edit = (fn: (c: Catalog) => void) => { const c = seedCatalog(); fn(c); return c; };
  it("refuses unsafe prices", () => {
    expect(catalogProblems(edit((c) => { c.apps.hotel!.editions.free!.priceMonthPaisa = 100; }))[0]).toMatch(/free edition's price is 0/);
    expect(catalogProblems(edit((c) => { c.apps.hotel!.editions.full!.priceYearPaisa = 70_000 * 13; }))[0]).toMatch(/12 monthly prices/);
    expect(catalogProblems(edit((c) => { c.apps.hotel!.editions.full!.priceMonthPaisa = 0; }))[0]).toMatch(/needs a monthly price/);
    expect(CatalogSchema.safeParse(edit((c) => { c.apps.hotel!.editions.full!.priceMonthPaisa = 70_000.5; })).success).toBe(false);
    expect(CatalogSchema.safeParse(edit((c) => { c.apps.pos!.editions.free!.limits.bills_per_month!.softOverPct = 150; })).success).toBe(false);
  });
  it("refuses a missing limit, a removed edition or app, a version going back, a free switch without a free edition", () => {
    const prev = seedCatalog();
    expect(catalogProblems(edit((c) => { delete c.apps.hotel!.editions.full!.limits.rooms; }))[0]).toMatch(/"rooms" is missing/);
    expect(catalogProblems(edit((c) => { delete c.apps.hotel!.editions.full; }), prev)[0]).toMatch(/can't be removed/);
    expect(catalogProblems(edit((c) => { delete c.apps.crm; }), prev)[0]).toMatch(/hide it instead/);
    expect(catalogProblems(edit((c) => { c.version = 0; }), { ...prev, version: 3 })[0]).toMatch(/version can't go back/);
    expect(catalogProblems(edit((c) => { c.apps.mail!.freeEditionEnabled = true; }))[0]).toMatch(/has none/);
  });
  it("billing rules: prices always include VAT (Q5)", () => {
    expect(BILLING_SETTING.guard!({ ...BILLING_SETTING.default, pricesIncludeVat: false }, BILLING_SETTING.default)).toMatch(/include VAT/);
    expect(BILLING_SETTING.schema.safeParse(BILLING_SETTING.default).success).toBe(true);
  });
});

describe("a saved catalog is never overwritten by a new release", () => {
  it("keeps saved numbers and only adds new apps, editions and limit keys", () => {
    const saved = seedCatalog();
    saved.apps.hotel!.editions.full!.priceMonthPaisa = 65_000;
    saved.apps.hotel!.editions.free!.limits.rooms = { value: 3, behaviour: "hard" };
    delete saved.apps.reviews;
    delete saved.apps.pos!.editions.full;
    delete saved.apps.pos!.editions.free!.limits.outlets;
    const out = withNewApps(saved);
    expect(out.apps.hotel!.editions.full!.priceMonthPaisa).toBe(65_000);
    expect(out.apps.hotel!.editions.free!.limits.rooms!.value).toBe(3);
    expect(out.apps.reviews).toEqual(seedCatalog().apps.reviews);
    expect(out.apps.pos!.editions.full).toBeDefined();
    expect(out.apps.pos!.editions.free!.limits.outlets!.value).toBe(1);
    expect(saved.apps.reviews).toBeUndefined(); // the saved object itself is not changed
  });
  it("a manifest's own price is used when the seed has none", () => {
    const a = appFromManifest({ id: "newapp", name: { en: "New" }, trialDays: 7, editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }, { id: "full", name: { en: "Full" }, free: false, limits: {}, features: [], price: { monthPaisa: 12_300, yearPaisa: 123_000 } }] });
    expect(a.editions.full).toMatchObject({ priceMonthPaisa: 12_300, priceYearPaisa: 123_000 });
  });
});

describe("the public view", () => {
  it("lists visible apps with prices and limits only", () => {
    const c = seedCatalog();
    c.apps.crm!.visible = false;
    const pub = publicCatalog(c);
    expect(pub.apps.some((a) => a.id === "crm")).toBe(false);
    expect(pub.apps.find((a) => a.id === "hotel")!.editions[1]).toEqual({ id: "full", name: { en: "Full" }, free: false, priceMonthPaisa: 70_000, priceYearPaisa: 700_000, limits: { rooms: 40 }, features: ["hotel.calendar", "hotel.channel_sync"] });
    const text = JSON.stringify(pub);
    expect(text).not.toMatch(/verif|\bpan\b|dhamiplus|partner|commission|"version"|needsPaidEdition|behaviour/i);
  });
});
