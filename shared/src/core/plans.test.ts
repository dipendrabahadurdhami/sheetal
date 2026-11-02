import { describe, expect, it } from "vitest";
import { atListingCap, isAllAccess, kindsFor, limitKeysFor, listingCap, priceFor, typesFor } from "./plans";
import { CATALOG } from "../data/catalog";
import { seed } from "../demo/demo";

const db = seed();
const plan = (id = "") => db.plans.find((p) => p.id === id);
const agency = { id: "x", type: "agency" };

describe("plans", () => {
  it("every business type has Starter, Business and Pro, and Starter is free", () => {
    for (const type of ["hotel", "host", "developer", "agency", "sponsor"]) {
      expect(db.plans.filter((p) => p.type === type).map((p) => p.name)).toEqual(["Starter", "Business", "Pro"]);
      expect(plan(`${type}-starter`)?.price).toBe(0);
    }
  });

  it("Starter allows one listing", () => {
    expect(listingCap(plan("agency-starter"))).toBe(1);
    expect(atListingCap(plan("agency-starter"), 0)).toBe(false);
    expect(atListingCap(plan("agency-starter"), 1)).toBe(true);
  });

  it("Business is limited to its own type, Pro sees every type and kind", () => {
    expect(typesFor(agency, plan("agency-business"))).toEqual(["agency"]);
    expect(kindsFor(CATALOG, agency, plan("agency-business"))).toEqual(["sell", "rentout"]);
    expect(isAllAccess(plan("agency-pro"))).toBe(true);
    expect(typesFor(agency, plan("agency-pro"))).toEqual(["hotel", "host", "developer", "agency", "sponsor"]);
    expect(kindsFor(CATALOG, agency, plan("agency-pro"))).toEqual(CATALOG.listingKinds.map((k) => k.id));
    expect(atListingCap(plan("agency-pro"), 5000)).toBe(false);
    expect(limitKeysFor("agency", plan("agency-pro"))).toContain("stays");
  });

  it("prices: Business 1,500 and Pro 3,000 a month, saving 9%, 19% and 39% for 3, 6 and 12 months", () => {
    const b = plan("agency-business"), p = plan("agency-pro");
    expect([1, 3, 6, 12].map((m) => priceFor(b, m))).toEqual([1500, 4095, 7290, 10980]);
    expect([1, 3, 6, 12].map((m) => priceFor(p, m))).toEqual([3000, 8190, 14580, 21960]);
    expect(priceFor(plan("agency-starter"), 12)).toBe(0);
  });

  it("Sheetal Property is on Agency Pro for a year, active and verified; auto-renew is off for everyone", () => {
    const t = db.tenants.find((x) => x.id === "t13");
    expect(t).toMatchObject({ name: "Sheetal Property", email: "shetalrealestate@gmail.com", planId: "agency-pro", status: "active", emailVerified: true, period: 12, renews: "2028-03-02" });
    expect(db.tenants.every((x) => x.autoRenew === false)).toBe(true);
  });
});
