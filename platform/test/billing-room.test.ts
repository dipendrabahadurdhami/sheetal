// requireRoom() (src/billing/room.ts): the one place an app asks whether its edition has room for one more record.
// Pure: entitlements are built from the seed catalog, no database.
import { describe, expect, it } from "vitest";
import { buildEntitlements } from "../src/tenancy/context.js";
import { seedCatalog } from "../src/billing/catalog.js";
import { buildEntitlementsV3 } from "../src/billing/entitlements.js";
import { editionCap, monthStart, onApps, requireRoom } from "../src/billing/room.js";
import { BILLING_DEFAULTS } from "../src/billing/types.js";

const now = new Date("2026-11-20T06:00:00Z");
const sub = (appId: string, editionId: string) => ({
  appId, editionId, status: "active" as const, periodMonths: editionId === "free" ? null : 1, priceGrossPaisa: 0,
  currentPeriodStart: editionId === "free" ? null : new Date("2026-11-01T00:00:00Z"), currentPeriodEnd: editionId === "free" ? null : new Date("2026-12-01T00:00:00Z"),
  trialEndsAt: null, trialUsedAt: null, cancelAtPeriodEnd: false, uninstalledAt: null,
});
const apps = (...subs: ReturnType<typeof sub>[]) => ({ entitlements: buildEntitlementsV3({ now, catalog: seedCatalog(), settings: { ...BILLING_DEFAULTS }, seatsUsed: 1, subscriptions: subs, grants: [], addons: [] }) });
const plans = { entitlements: buildEntitlements({ type: "hotel", plan: { features: {} }, limits: { rooms: 2 }, seatsUsed: 1 }) };
const refused = async (p: Promise<void>) => p.then(() => null, (e: { statusCode: number; code: string }) => `${e.statusCode} ${e.code}`);

describe("requireRoom", () => {
  it("a hard limit: room up to the number, then 402 limit_reached; several at once are counted together", async () => {
    const ctx = apps(sub("hotel", "free")); // 5 rooms
    expect(await refused(requireRoom(ctx, "hotel", "rooms", () => 4))).toBeNull();
    expect(await refused(requireRoom(ctx, "hotel", "rooms", () => 5))).toBe("402 limit_reached");
    expect(await refused(requireRoom(ctx, "hotel", "rooms", () => 3, 2))).toBeNull();
    expect(await refused(requireRoom(ctx, "hotel", "rooms", () => 3, 3))).toBe("402 limit_reached");
  });

  it("a soft limit (money-in): 20% over is allowed, then it stops", async () => {
    const ctx = apps(sub("pos", "free")); // 100 bills a month, soft
    expect(await refused(requireRoom(ctx, "pos", "bills_per_month", () => 100))).toBeNull();
    expect(await refused(requireRoom(ctx, "pos", "bills_per_month", () => 119))).toBeNull();
    expect(await refused(requireRoom(ctx, "pos", "bills_per_month", () => 120))).toBe("402 limit_reached");
  });

  it("unlimited on the full edition; a limit of 0 on the free one refuses the first", async () => {
    expect(await refused(requireRoom(apps(sub("invoicing", "full")), "invoicing", "invoices_per_month", () => 100_000))).toBeNull();
    expect(await refused(requireRoom(apps(sub("expenses", "free")), "expenses", "recurring_templates", () => 0))).toBe("402 limit_reached");
    expect(await refused(requireRoom(apps(sub("expenses", "full")), "expenses", "recurring_templates", () => 500))).toBeNull();
  });

  it("a business on its plan is not checked here and the count is never asked for", async () => {
    let asked = 0;
    expect(await refused(requireRoom(plans, "hotel", "rooms", () => { asked++; return 999; }))).toBeNull();
    expect(asked).toBe(0);
    expect(onApps(plans)).toBe(false);
    expect(editionCap(plans, "hotel", "rooms")).toBeNull();
  });

  it("editionCap gives the number for screens, -1 for unlimited", () => {
    expect(editionCap(apps(sub("hotel", "free")), "hotel", "rooms")).toBe(5);
    expect(editionCap(apps(sub("rentals", "full")), "rentals", "leases")).toBe(-1);
  });

  it("monthStart is the first moment of the Nepal calendar month (18:15 UTC the day before)", () => {
    expect(monthStart(new Date("2026-11-20T06:00:00Z")).toISOString()).toBe("2026-10-31T18:15:00.000Z");
    expect(monthStart(new Date("2026-10-31T18:14:59Z")).toISOString()).toBe("2026-09-30T18:15:00.000Z"); // still October in Nepal
    expect(monthStart(new Date("2026-10-31T18:15:00Z")).toISOString()).toBe("2026-10-31T18:15:00.000Z"); // November has begun
  });
});
