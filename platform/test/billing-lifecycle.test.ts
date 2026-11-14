// Tests for the subscription lifecycle job (P3-BE-5; suite 1 of PHASE-3-TEST-PLAN.md) with a fake clock: one renewal invoice 7 days before the
// end (never twice), reminders at 7 and 1 days, statuses announced once (past due, ended on the free edition, read-only for a paid-only app),
// cancelled ones not renewed, price protection and waiting downgrades in the renewal, businesses on "plans" untouched.
// Where it fits: platform/src/billing/lifecycle.ts on the suite's throwaway PostgreSQL. Dates in 2030 (no other test uses them).
// Run with: npm run test -w @sheetal/platform
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { seedCatalog } from "../src/billing/catalog.js";
import { runSubscriptionLifecycle } from "../src/billing/lifecycle.js";
import { BILLING_DEFAULTS } from "../src/billing/types.js";
import { testDb } from "./expense-fixture.js";

let db: Db;
const NPT = (ymd: string) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() - 345 * 60_000);
const catalog = seedCatalog();
const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return log; }, level: "silent", silent() {} } as never;
const run = (ymd: string) => runSubscriptionLifecycle(db, { log, now: new Date(NPT(ymd).getTime() + 6 * 3_600_000), catalog, settings: BILLING_DEFAULTS });

async function business(mode: "apps" | "plans" = "apps"): Promise<string> {
  await db.$executeRawUnsafe(`INSERT INTO plans (id, type, name, price, limits, features) VALUES ('p3life-plan', 'hotel', 'Business', 1500, '{}', '{}') ON CONFLICT DO NOTHING`);
  const id = `p3life-${randomUUID().slice(0, 8)}`;
  await db.$executeRawUnsafe(`INSERT INTO tenants (id, name, type, plan_id, billing_mode, updated_at) VALUES ($1, 'Life Hotel', 'hotel', 'p3life-plan', $2, now())`, id, mode);
  return id;
}
const paid = (tenantId: string, appId: string, o: Record<string, unknown> = {}) => db.subscription.create({ data: {
  tenantId, appId, editionId: "full", status: "active", periodMonths: 1, priceGrossPaisa: 70_000n, listPriceGrossPaisa: 70_000n,
  currentPeriodStart: NPT("2030-09-01"), currentPeriodEnd: NPT("2030-10-01"), source: "purchase", ...o,
} });
const invoicesOf = (tenantId: string) => db.invoice.findMany({ where: { tenantId, kind: "subscription" }, include: { lines: { orderBy: { sort: "asc" } } } });
const events = async (tenantId: string) => (await db.subscriptionEvent.findMany({ where: { tenantId }, orderBy: { at: "asc" } })).map((e) => e.type);

beforeAll(() => { db = testDb(); });
afterAll(async () => { await db.$disconnect(); });

describe("the renewal timeline of one paid app", () => {
  it("invoices once 7 days before, reminds at 7 and 1 days, then announces past due and the fall to the free edition, each once", async () => {
    const t = await business();
    const s = await paid(t, "hotel");
    await run("2030-09-20"); // 11 days left: nothing yet
    expect(await invoicesOf(t)).toHaveLength(0);
    await run("2030-09-25"); // 6 days left
    await run("2030-09-25"); // twice: nothing more
    const inv = await invoicesOf(t);
    expect(inv).toHaveLength(1);
    expect(inv[0]!).toMatchObject({ status: "open", totalPaisa: 70_000n });
    expect(inv[0]!.lines[0]).toMatchObject({ kind: "subscription", appId: "hotel", grossPaisa: 70_000n, periodStart: NPT("2030-10-01"), periodEnd: NPT("2030-11-01") });
    await run("2030-09-30");
    expect(await events(t)).toEqual(["reminder_7", "reminder_1"]);
    await run("2030-10-03");
    await run("2030-10-04");
    expect((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("past_due");
    await run("2030-10-08"); // grace (7 days) over: Hotel has a free edition
    expect((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("expired");
    expect(await events(t)).toEqual(["reminder_7", "reminder_1", "past_due", "expired"]);
    expect(await invoicesOf(t)).toHaveLength(1); // still the one renewal invoice
  });

  it("a paid-only app goes read-only after the grace", async () => {
    const t = await business();
    const s = await paid(t, "mail", { priceGrossPaisa: 20_000n });
    await run("2030-10-09");
    expect((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("read_only");
  });
});

describe("what a renewal contains", () => {
  it("a cancelled subscription gets no renewal invoice", async () => {
    const t = await business();
    await paid(t, "hotel", { cancelAtPeriodEnd: true });
    await run("2030-09-28");
    expect(await invoicesOf(t)).toHaveLength(0);
  });
  it("co-termed apps renew on one invoice; a migrated business's lock adds the price protection line", async () => {
    const t = await business();
    await paid(t, "hotel");
    await paid(t, "crm", { priceGrossPaisa: 30_000n });
    await db.billingLock.create({ data: { tenantId: t, legacyMonthlyGrossPaisa: 80_000n, legacyPeriodMonths: 1, coversApps: ["hotel", "crm"], lockEnd: NPT("2031-10-01"), migrationRunId: "run-1" } });
    await run("2030-09-26");
    const inv = await invoicesOf(t);
    expect(inv).toHaveLength(1);
    expect(inv[0]!.lines.map((l) => [l.kind, Number(l.grossPaisa)])).toEqual([["subscription", 70_000], ["subscription", 30_000], ["price_protection", -20_000]]);
    expect(inv[0]!.totalPaisa).toBe(80_000n);
  });
  it("a waiting downgrade renews at the new edition's catalog price", async () => {
    const t = await business();
    await paid(t, "hotel", { priceGrossPaisa: 90_000n, pendingEditionId: "full" });
    await run("2030-09-27");
    expect((await invoicesOf(t))[0]!.lines[0]).toMatchObject({ editionId: "full", grossPaisa: 70_000n });
  });
  it("a business on plans is never touched", async () => {
    const t = await business("plans");
    const s = await paid(t, "hotel");
    await run("2030-10-20");
    expect((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("active");
    expect(await invoicesOf(t)).toHaveLength(0);
  });
});
