// Entitlement parity (P3-BE-3, suite 4 of PHASE-3-TEST-PLAN.md): today's builder (v1, plans) answers what the hand-written oracle says, and the
// new builder (v3, app subscriptions) built from the plan-to-apps mapping (rules R1 to R4, R6) never gives LESS than v1 for any fixture.
// "More" is allowed (the new free tier and paid editions are more generous in places) and is listed so it can be read.
// Run with: npm run test -w @sheetal/backend-core (pure: no database).
import { describe, expect, it } from "vitest";
import { buildEntitlements } from "@sheetal/platform/tenancy/context";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import { seedCatalog } from "@sheetal/platform/billing/catalog";
import { mapPlanToApps } from "@sheetal/platform/billing/mapping";
import { buildEntitlementsV3 } from "@sheetal/platform/billing/entitlements";
import { compareEntitlements } from "@sheetal/platform/billing/shadow";
import { BILLING_DEFAULTS } from "@sheetal/platform/billing/types";
import { ALL_APPS, oracleHasApp, oracleLimit, oracleSeats } from "./billing-oracle.js";
import { P3_BUSINESSES, limitsOf } from "./fixtures/p3-businesses.js";

const NOW = new Date("2026-11-20T06:00:00Z");
const LOCK_END = new Date("2027-12-01T00:00:00Z");
const catalog = seedCatalog();

function v3For(b: (typeof P3_BUSINESSES)[number]) {
  const limits = limitsOf(b);
  const m = mapPlanToApps({ type: b.type, plan: { price: b.plan.price, limits, features: b.plan.features }, manifests: APPS, catalog });
  return buildEntitlementsV3({
    now: NOW, catalog, settings: BILLING_DEFAULTS, seatsUsed: 1,
    subscriptions: m.subscriptions.map((s) => ({
      appId: s.appId, editionId: s.editionId, status: "active", periodMonths: s.editionId === "free" ? null : 1, priceGrossPaisa: 0,
      currentPeriodStart: s.editionId === "free" ? null : new Date("2026-11-01T00:00:00Z"), currentPeriodEnd: s.editionId === "free" ? null : new Date("2026-12-01T00:00:00Z"),
      trialEndsAt: null, trialUsedAt: null, cancelAtPeriodEnd: false, uninstalledAt: null,
    })),
    grants: m.grants.map((g) => ({ ...g, startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: LOCK_END, revokedAt: null })),
    addons: [],
  });
}

describe("v1 equals the oracle", () => {
  it.each(P3_BUSINESSES)("$name", (b) => {
    const limits = limitsOf(b);
    const v1 = buildEntitlements({ type: b.type, plan: b.plan, limits, seatsUsed: 1 });
    for (const id of ALL_APPS) expect(v1.hasApp(id), id).toBe(oracleHasApp(b.type, b.plan.features, id));
    for (const k of ["rooms", "units", "projects", "listings", "stays", "investments", "outlets", "featured"]) expect(v1.limit("any", k), k).toBe(oracleLimit(limits, k));
    expect(v1.seats().limit).toBe(oracleSeats(limits));
    expect(v1.mode).toBe("plans");
    expect(v1.access!("hotel")).toBe(oracleHasApp(b.type, b.plan.features, "hotel") ? "full" : "none");
    expect(() => v1.requireWrite!("hotel")).not.toThrow(); // a plan never makes anything read-only
  });
});

describe("v3 from the mapping never gives less than v1", () => {
  it.each(P3_BUSINESSES)("$name", (b) => {
    const limits = limitsOf(b);
    const v1 = buildEntitlements({ type: b.type, plan: b.plan, limits, seatsUsed: 1 });
    const diffs = compareEntitlements({ type: b.type, appIds: APPS.filter((a) => a.kind === "app").map((a) => a.id), oldLimits: limits, oldFeatures: b.plan.features, v1, v3: v3For(b) });
    expect(diffs.filter((d) => d.kind === "less")).toEqual([]);
  });

  it("a starter hotel keeps its 10 rooms (more than the new free 5) through a grant; Business keeps 10 seats; Pro keeps unlimited listings", () => {
    const by = (n: string) => v3For(P3_BUSINESSES.find((b) => b.name === n)!);
    expect(by("hotel Starter").limit("hotel", "rooms")).toBe(10);
    expect(by("hotel Starter").edition("hotel")).toBe("free");
    expect(by("hotel Business").seats().limit).toBe(10);
    expect(by("hotel Business with 5 more seats and 10 more rooms").seats().limit).toBe(15);
    expect(by("hotel Business with 5 more seats and 10 more rooms").limit("hotel", "rooms")).toBe(50);
    expect(by("agency Pro").limit("listings", "listings")).toBe(null);
    expect(by("agency Pro").limit("promote", "featured_slots")).toBe(20);
    expect(by("developer Business").edition("pos")).toBe(null); // no POS for a developer, as today
  });
});
