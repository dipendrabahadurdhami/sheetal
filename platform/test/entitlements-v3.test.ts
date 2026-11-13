// Tests for entitlements v3 (P3-BE-3): access modes from the dates, edition, limits raised by grants and add-ons, features, seats, and the two
// refusals (402 subscription_read_only, 402 limit_reached with the MB 6.3 body). Pure: the rows are passed in.
// Run with: npm run test -w @sheetal/platform
import { describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors.js";
import { seedCatalog } from "../src/billing/catalog.js";
import { buildEntitlementsV3, type EntitlementsV3Input } from "../src/billing/entitlements.js";
import { modeOf } from "../src/billing/load.js";
import { BILLING_DEFAULTS, type SubscriptionState } from "../src/billing/types.js";

const NPT = (ymd: string) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() - 345 * 60_000);
const catalog = seedCatalog();
const sub = (appId: string, o: Partial<SubscriptionState> = {}): SubscriptionState => ({
  appId, editionId: "full", status: "active", periodMonths: 1, priceGrossPaisa: 70_000, currentPeriodStart: NPT("2026-11-01"), currentPeriodEnd: NPT("2026-12-01"),
  trialEndsAt: null, trialUsedAt: null, cancelAtPeriodEnd: false, uninstalledAt: null, ...o,
});
const free = (appId: string) => sub(appId, { editionId: "free", periodMonths: null, priceGrossPaisa: 0, currentPeriodStart: null, currentPeriodEnd: null });
const build = (o: Partial<EntitlementsV3Input>) => buildEntitlementsV3({ now: NPT("2026-11-20"), catalog, settings: BILLING_DEFAULTS, subscriptions: [], grants: [], addons: [], seatsUsed: 1, ...o });
const thrown = (fn: () => unknown) => { try { fn(); } catch (e) { return e as AppError; } throw new Error("did not throw"); };

describe("access and edition", () => {
  it("free, paid, past due, fallen back, read-only, locked, not installed; the workspace is always full", () => {
    const e = build({ subscriptions: [free("crm"), sub("hotel")] });
    expect([e.access("crm"), e.edition("crm"), e.access("hotel"), e.edition("hotel"), e.access("pos"), e.access("workspace")]).toEqual(["full", "free", "full", "full", "none", "full"]);
    expect(e.hasApp("pos")).toBe(false);
    const late = build({ now: NPT("2026-12-03"), subscriptions: [sub("hotel")] });
    expect([late.access("hotel"), late.statuses().hotel!.status]).toEqual(["full", "past_due"]);
    const fell = build({ now: NPT("2026-12-09"), subscriptions: [sub("hotel")] });
    expect([fell.access("hotel"), fell.edition("hotel"), fell.limit("hotel", "rooms")]).toEqual(["limited", "free", 5]);
    const mail = build({ now: NPT("2026-12-09"), subscriptions: [sub("mail", { priceGrossPaisa: 20_000 })] }); // no free edition
    expect([mail.access("mail"), mail.hasApp("mail")]).toEqual(["read_only", true]);
    expect(build({ now: NPT("2027-03-01"), subscriptions: [sub("mail")] }).access("mail")).toBe("locked");
  });
  it("a staff grant of an app gives full access while it lasts", () => {
    const g = { kind: "app", appId: "pos", key: "full", value: null, startsAt: NPT("2026-11-01"), endsAt: NPT("2026-12-01"), revokedAt: null };
    expect(build({ grants: [g] }).edition("pos")).toBe("full");
    expect(build({ grants: [{ ...g, revokedAt: NPT("2026-11-10") }] }).access("pos")).toBe("none");
    expect(build({ now: NPT("2026-12-02"), grants: [g] }).access("pos")).toBe("none");
  });
});

describe("refusals", () => {
  it("requireWrite: full and limited write; read-only and locked get 402 subscription_read_only; not installed gets 403", () => {
    expect(() => build({ subscriptions: [free("crm")] }).requireWrite("crm")).not.toThrow();
    const ro = thrown(() => build({ now: NPT("2026-12-09"), subscriptions: [sub("mail")] }).requireWrite("mail"));
    expect(ro).toMatchObject({ statusCode: 402, code: "subscription_read_only", details: { appId: "mail", access: "read_only" } });
    expect(ro.message).toMatch(/see, print and export/);
    expect(thrown(() => build({ now: NPT("2027-03-01"), subscriptions: [sub("mail")] }).requireWrite("mail")).message).toMatch(/Your data is safe/);
    expect(thrown(() => build({}).requireWrite("hotel"))).toMatchObject({ statusCode: 403, code: "app_not_available" });
    expect(() => build({}).requireWrite("workspace")).not.toThrow();
  });
  it("requireLimit: hard at the limit with the one error body; soft POS bills go 20% over; warns from 80%", () => {
    const e = build({ subscriptions: [free("hotel"), free("pos")] });
    expect(e.requireLimit("hotel", "rooms", { used: 3 })).toEqual({ warn: true, over: false });
    const err = thrown(() => e.requireLimit("hotel", "rooms", { used: 5 }));
    expect(err).toMatchObject({ statusCode: 402, code: "limit_reached", details: { appId: "hotel", key: "rooms", limit: 5, used: 5, behaviour: "hard", tryEdition: "full", tryPricePaisa: 70_000 } });
    expect(err.message).toBe("Your Free Hotel PMS has room for 5 and 5 are used.");
    expect(e.requireLimit("pos", "bills_per_month", { used: 110 })).toEqual({ warn: true, over: true });
    expect(thrown(() => e.requireLimit("pos", "bills_per_month", { used: 120 }))).toMatchObject({ code: "limit_reached", details: { behaviour: "soft" } });
  });
});

describe("limits, features and seats", () => {
  it("grants and add-ons only raise; unlimited (null) wins", () => {
    const g = (value: number | null) => ({ kind: "limit", appId: "listings", key: "listings", value, startsAt: NPT("2026-11-01"), endsAt: null, revokedAt: null });
    const add = { appId: "listings", addonKey: "listings_pack", qty: 2, currentPeriodEnd: NPT("2026-12-01") };
    expect(build({ subscriptions: [free("listings")], grants: [g(1)] }).limit("listings", "listings")).toBe(3); // a smaller grant changes nothing
    expect(build({ subscriptions: [free("listings")], grants: [g(150)] }).limit("listings", "listings")).toBe(150);
    expect(build({ subscriptions: [sub("listings")], addons: [add] }).limit("listings", "listings")).toBe(550);
    expect(build({ subscriptions: [sub("listings")], grants: [g(null)], addons: [add] }).limit("listings", "listings")).toBe(null);
    expect(build({ subscriptions: [sub("listings")], addons: [{ ...add, currentPeriodEnd: NPT("2026-11-10") }] }).limit("listings", "listings")).toBe(500); // ended
    expect(build({}).limit("hotel", "rooms")).toBe(0); // no app: nothing may be added
  });
  it("features come from editions in use, business paid features from any paid app, or a grant", () => {
    expect(build({ subscriptions: [free("hotel")] }).feature("hotel.channel_sync")).toBe(false);
    expect(build({ subscriptions: [sub("hotel")] }).feature("hotel.channel_sync")).toBe(true);
    expect(build({ subscriptions: [free("hotel")] }).feature("custom_roles")).toBe(false);
    expect(build({ subscriptions: [sub("crm", { priceGrossPaisa: 30_000 })] }).feature("custom_roles")).toBe(true);
    expect(build({ grants: [{ kind: "feature", appId: null, key: "api.access", value: null, startsAt: NPT("2026-11-01"), endsAt: null, revokedAt: null }] }).feature("api.access")).toBe(true);
  });
  it("seats: the free seats, a bigger seat grant, plus seat add-ons", () => {
    expect(build({}).seats()).toEqual({ used: 1, limit: 2 });
    const grant = { kind: "seats", appId: null, key: null, value: 10, startsAt: NPT("2026-11-01"), endsAt: null, revokedAt: null };
    expect(build({ grants: [grant], addons: [{ appId: "", addonKey: "seats", qty: 3, currentPeriodEnd: NPT("2026-12-01") }] }).seats().limit).toBe(13);
    expect(build({ grants: [{ ...grant, value: null }] }).seats().limit).toBe(null);
  });
  it("the billing mode word is read safely (anything unknown is today's plans)", () => {
    expect([modeOf("apps"), modeOf("shadow"), modeOf("plans"), modeOf(undefined), modeOf("x")]).toEqual(["apps", "shadow", "plans", "plans", "plans"]);
  });
});
