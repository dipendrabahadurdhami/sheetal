// Tests for the payment router (P3-BE-9, MB section 12): two payment systems that never mix, paused and down connections hidden, test mode kept
// apart in production. Pure, plus one database check of the loader.
// Run with: npm run test -w @sheetal/platform
import { afterAll, describe, expect, it } from "vitest";
import { PAYMENT_INTEGRATIONS, PaymentRouteError, assertMethodFor, loadPaymentConnections, resolvePaymentMethods, type ConnectionRow } from "../src/payments/router.js";
import { BUSINESS_PAYMENTS, settingProblems } from "../src/settings/defs.js";
import { testDb } from "./expense-fixture.js";

const conn = (o: Partial<ConnectionRow> & { id: string }): ConnectionRow => ({ integrationId: "esewa", scope: "platform", tenantId: null, state: "live", mode: "live", healthStatus: "healthy", ...o });
const CONNS = [
  conn({ id: "sheetal-esewa" }),
  conn({ id: "sheetal-khalti", integrationId: "khalti" }),
  conn({ id: "sheetal-fonepay-paused", integrationId: "fonepay", state: "paused" }),
  conn({ id: "sheetal-card-down", integrationId: "card", healthStatus: "down" }),
  conn({ id: "sheetal-khalti-test", integrationId: "khalti", state: "test_passed", mode: "test" }),
  conn({ id: "biz-esewa", scope: "business", tenantId: "biz-1" }),
  conn({ id: "other-biz-esewa", scope: "business", tenantId: "biz-2" }),
  conn({ id: "sheetal-whatsapp", integrationId: "whatsapp" }),
];
const ids = (m: ReturnType<typeof resolvePaymentMethods>) => m.map((x) => (x.kind === "gateway" ? x.connectionId : x.kind));

describe("two payment systems", () => {
  it("a subscription is offered only Sheetal's live, healthy connections (+ bank transfer), never a business's", () => {
    const m = resolvePaymentMethods({ purpose: "sheetal.subscription", tenantId: "biz-1", connections: CONNS, env: "production", bankTransfer: true });
    expect(ids(m)).toEqual(["sheetal-esewa", "sheetal-khalti", "manual"]); // paused, down, test-mode and non-payment connections hidden
    expect(m.every((x) => x.owner === "sheetal")).toBe(true);
  });
  it("a business's checkout is offered only its own connections, then its static QR and manual recording; never Sheetal's, never another business's", () => {
    const m = resolvePaymentMethods({ purpose: "business.invoice", tenantId: "biz-1", connections: CONNS, env: "production", staticQr: true });
    expect(ids(m)).toEqual(["biz-esewa", "static_qr", "manual"]);
    expect(ids(resolvePaymentMethods({ purpose: "business.pos", tenantId: "biz-3", connections: CONNS, env: "production" }))).toEqual(["manual"]); // no fall-back to Sheetal's
  });
  it("assertMethodFor refuses the other system's connection and one that is not offered now", () => {
    const base = { tenantId: "biz-1", connections: CONNS, env: "production" as const };
    expect(() => assertMethodFor({ ...base, purpose: "sheetal.subscription", connectionId: "biz-esewa" })).toThrow(/can't go through a business's gateway/);
    expect(() => assertMethodFor({ ...base, purpose: "business.invoice", connectionId: "sheetal-esewa" })).toThrow(/can't pay through Sheetal's gateway/);
    expect(() => assertMethodFor({ ...base, purpose: "business.invoice", connectionId: "other-biz-esewa" })).toThrow(PaymentRouteError);
    expect(() => assertMethodFor({ ...base, purpose: "sheetal.subscription", connectionId: "sheetal-fonepay-paused" })).toThrow(/isn't available right now/);
    expect(assertMethodFor({ ...base, purpose: "sheetal.subscription", connectionId: "sheetal-esewa" })).toMatchObject({ owner: "sheetal", mode: "live" });
  });
  it("test mode: shown outside production (as today) and to staff testing on purpose; recorded as test", () => {
    expect(ids(resolvePaymentMethods({ purpose: "sheetal.subscription", tenantId: null, connections: CONNS, env: "development" }))).toContain("sheetal-khalti-test");
    const staff = resolvePaymentMethods({ purpose: "sheetal.subscription", tenantId: null, connections: CONNS.map((c) => (c.id === "sheetal-khalti-test" ? { ...c, state: "live" } : c)), env: "production", staffTest: true });
    expect(staff.find((x) => x.kind === "gateway" && x.connectionId === "sheetal-khalti-test")).toMatchObject({ mode: "test" });
  });
  it("only payment integrations count, and the business payments setting is valid", () => {
    expect(PAYMENT_INTEGRATIONS).toEqual(expect.arrayContaining(["esewa", "khalti", "fonepay", "fonepay_qr", "card"]));
    expect(PAYMENT_INTEGRATIONS).not.toContain("whatsapp");
    expect(BUSINESS_PAYMENTS.schema.safeParse(BUSINESS_PAYMENTS.default).success).toBe(true);
    expect(settingProblems()).toEqual([]);
  });
});

describe("the loader", () => {
  const db = testDb();
  afterAll(async () => { await db.integrationConnection.deleteMany({ where: { ownerKey: { startsWith: "p3pay-" } } }); await db.$disconnect(); });
  it("reads Sheetal's connections for Sheetal's purposes and one business's for its own", async () => {
    await db.integrationConnection.createMany({ data: [
      { integrationId: "esewa", scope: "platform", tenantId: null, ownerKey: "p3pay-platform", state: "live", mode: "live", config: {} },
    ] });
    const mine = await loadPaymentConnections(db, "sheetal.subscription", "anything");
    expect(mine.some((c) => c.integrationId === "esewa")).toBe(true);
    expect(mine.every((c) => c.scope === "platform" && c.tenantId === null)).toBe(true);
    expect((await loadPaymentConnections(db, "business.invoice", null)).length).toBe(0); // a business purpose with no business finds nothing
  });
});
