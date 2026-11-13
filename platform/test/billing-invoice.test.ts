// Tests for Phase 3 invoices (P3-BE-4; suites 6 to 9 of PHASE-3-TEST-PLAN.md): the invoice stored from a quote, the tax invoice number at
// payment (consecutive under concurrency, no gap after a failure, by Nepal fiscal year), applying it once, the revenue rows (every split adds
// back; test payments make none; a setting change never rewrites old rows) and credit notes with the original percentages.
// Where it fits: platform/src/billing/invoice.ts on the suite's throwaway PostgreSQL. Dates are in 2030-2031 (fiscal years 2087-88 and
// 2088-89) so no other test's numbers mix in.
// Run with: npm run test -w @sheetal/platform
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { seedCatalog } from "../src/billing/catalog.js";
import { quote } from "../src/billing/quote.js";
import { applySubscriptionPayment, createInvoiceFromQuote, fiscalYear, issueCreditNote, revenueRows, taxNumber } from "../src/billing/invoice.js";
import { BILLING_DEFAULTS } from "../src/billing/types.js";
import { REVENUE_SHARE_DEFAULT, type RevenueShare } from "../src/settings/revenue-share.js";
import { testDb } from "./expense-fixture.js";

let db: Db;
const NOW = new Date("2030-08-10T06:00:00Z"); // Nepal fiscal year 2087-88
const catalog = seedCatalog();
const share: RevenueShare = { ...REVENUE_SHARE_DEFAULT };
const seller = { name: "Sheetal Property" };
const SETTINGS = { ...BILLING_DEFAULTS, salesEnabled: true };

async function business(): Promise<string> {
  await db.$executeRawUnsafe(`INSERT INTO plans (id, type, name, price, limits, features) VALUES ('p3inv-plan', 'hotel', 'Business', 1500, '{}', '{}') ON CONFLICT DO NOTHING`);
  const id = `p3inv-${randomUUID().slice(0, 8)}`;
  await db.$executeRawUnsafe(`INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ($1, 'Invoice Hotel', 'hotel', 'p3inv-plan', now())`, id);
  return id;
}

/** A stored invoice for buying Hotel Full monthly (Rs 700) and a payment for it. */
async function bought(tenantId: string, o: { mode?: "live" | "test"; amountPaisa?: bigint; now?: Date } = {}) {
  const now = o.now ?? NOW;
  const q = quote({ now, business: { anchorDay: null, subscriptions: [], lock: null }, items: [{ kind: "subscribe", appId: "hotel", editionId: "full", periodMonths: 1 }], catalog, settings: SETTINGS });
  const inv = await db.$transaction((tx) => createInvoiceFromQuote(tx, { tenantId, quote: q, by: null, billedTo: { name: "Invoice Hotel" }, catalogVersion: 1 }));
  const pay = await db.payment.create({ data: { invoiceId: inv.id, tenantId, provider: "esewa", amount: 700, amountPaisa: o.amountPaisa ?? 70_000n, mode: o.mode ?? "live", ref: `R-${randomUUID()}` } });
  return { q, inv, pay };
}
const apply = (paymentId: string, now = NOW, s = share) => db.$transaction((tx) => applySubscriptionPayment(tx, { paymentId, now, appSales: s.appSales, share: s, seller }));

beforeAll(() => { db = testDb(); });
afterAll(async () => { await db.$disconnect(); });

describe("fiscal year in Nepal time", () => {
  it("Shrawan 1 starts at 00:00 Nepal (18:15 UTC the day before)", () => {
    expect(fiscalYear(new Date("2026-07-16T18:00:00Z"))).toBe("2082-83"); // 23:45 on 16 July in Nepal
    expect(fiscalYear(new Date("2026-07-16T18:45:00Z"))).toBe("2083-84"); // 00:30 on 17 July (Shrawan 1) in Nepal
    expect(fiscalYear(new Date("2027-07-16T17:00:00Z"))).toBe("2083-84");
    expect(taxNumber("2083-84", 7)).toBe("INV-2083-84-0007");
    expect(taxNumber("2083-84", 7, "credit")).toBe("CN-2083-84-0007");
  });
});

describe("the invoice from a quote, paid", () => {
  it("stores exactly the quote; paying gives the tax number, the subscription, revenue rows that add up, the event and the audit row", async () => {
    const t = await business();
    const { q, inv, pay } = await bought(t);
    expect(inv).toMatchObject({ kind: "subscription", status: "open", planId: null, totalPaisa: BigInt(q.totalPaisa), vatPaisa: BigInt(q.vatPaisa), no: null });
    expect(inv.lines.map((l) => [l.kind, l.appId, Number(l.grossPaisa)])).toEqual(q.lines.map((l) => [l.kind, l.appId, l.grossPaisa]));
    const r = await apply(pay.id);
    expect(r.applied).toBe(true);
    expect(r.number).toMatch(/^INV-2087-88-\d{4}$/);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after).toMatchObject({ status: "paid", fy: "2087-88", sellerSnapshot: seller });
    expect(await db.subscription.findUniqueOrThrow({ where: { tenantId_appId: { tenantId: t, appId: "hotel" } } })).toMatchObject({ editionId: "full", status: "active", periodMonths: 1, priceGrossPaisa: 70_000n });
    expect(await db.subscriptionEvent.count({ where: { tenantId: t, type: "purchased" } })).toBe(1);
    const rev = await db.revenueEntry.findMany({ where: { invoiceId: inv.id } });
    expect(rev.reduce((a, x) => a + x.netPaisa, 0n)).toBe(after.subtotalPaisa);
    expect(rev.reduce((a, x) => a + x.grossPaisa, 0n)).toBe(after.totalPaisa);
    expect(rev[0]).toMatchObject({ commissionBp: 10_000, publisherPaisa: 0n, partnerPaisa: 0n, saleType: "new", mode: "live" }); // 100% until the owner enters the split
    expect(await db.eventOutbox.count({ where: { tenantId: t, name: "platform.invoice.issued" } })).toBe(1);
    expect(await db.auditLog.count({ where: { tenantId: t, action: "billing.subscription_paid" } })).toBe(1);
  });

  it("returning twice, or twice at once, applies once: one number, one revenue set", async () => {
    const t = await business();
    const { inv, pay } = await bought(t);
    const both = await Promise.all([apply(pay.id), apply(pay.id)]);
    expect(both.filter((x) => x.applied)).toHaveLength(1);
    expect(await apply(pay.id)).toMatchObject({ applied: false, number: both.find((x) => x.applied)!.number });
    expect(await db.revenueEntry.count({ where: { invoiceId: inv.id } })).toBe(1);
  });

  it("two payments at once get two consecutive numbers; a failed payment leaves no gap", async () => {
    const at = new Date("2031-01-05T06:00:00Z"); // fiscal year 2087-88 too, but its own invoices
    const a = await bought(await business(), { now: at }), b = await bought(await business(), { now: at });
    const [ra, rb] = await Promise.all([apply(a.pay.id, at), apply(b.pay.id, at)]);
    const nos = [ra.number!, rb.number!].map((n) => Number(n.slice(-4))).sort((x, y) => x - y);
    expect(nos[1]! - nos[0]!).toBe(1);
    const c = await bought(await business(), { now: at });
    await expect(db.$transaction(async (tx) => {
      await applySubscriptionPayment(tx, { paymentId: c.pay.id, now: at, appSales: share.appSales, share, seller });
      throw new Error("the payment step failed after numbering");
    })).rejects.toThrow(/failed after numbering/);
    const d = await bought(await business(), { now: at });
    expect(Number((await apply(d.pay.id, at)).number!.slice(-4))).toBe(nos[1]! + 1); // the rolled-back number is given again
  });

  it("refuses a payment whose paisa don't match; a test payment makes no revenue", async () => {
    const t = await business();
    const off = await bought(t, { amountPaisa: 69_999n });
    await expect(apply(off.pay.id)).rejects.toThrow(/doesn't match/);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: off.inv.id } })).status).toBe("open");
    const t2 = await business();
    const test = await bought(t2, { mode: "test" });
    expect((await apply(test.pay.id)).applied).toBe(true);
    expect(await db.revenueEntry.count({ where: { invoiceId: test.inv.id } })).toBe(0);
  });

  it("keeps the percentages used at the sale; a credit note reverses with them, once", async () => {
    const t = await business();
    const split: RevenueShare = { ...share, appSales: { commissionPct: 20, perApp: {} }, technologyPartner: { enabled: true, name: "x", sharePct: 30, appliesTo: "all", apps: [] }, effectiveFrom: "2030-01-01" };
    const { inv, pay } = await bought(t);
    await apply(pay.id, NOW, split);
    const sale = await db.revenueEntry.findFirstOrThrow({ where: { invoiceId: inv.id, kind: "sale" } });
    expect(sale).toMatchObject({ commissionBp: 2_000, partnerBp: 3_000 });
    expect(sale.commissionPaisa + sale.publisherPaisa).toBe(sale.netPaisa);
    expect(sale.partnerPaisa + sale.sheetalNetPaisa).toBe(sale.commissionPaisa);
    const cn = await db.$transaction((tx) => issueCreditNote(tx, { invoiceId: inv.id, now: NOW, by: "staff-1", reason: "Refund in the 7-day window" }));
    expect(cn.number).toMatch(/^CN-2087-88-\d{4}$/);
    const refund = await db.revenueEntry.findFirstOrThrow({ where: { invoiceId: inv.id, kind: "refund" } });
    expect(refund).toMatchObject({ commissionBp: 2_000, partnerBp: 3_000, netPaisa: -sale.netPaisa, commissionPaisa: -sale.commissionPaisa });
    const credit = await db.invoice.findUniqueOrThrow({ where: { id: cn.creditId } });
    expect(credit).toMatchObject({ kind: "credit", creditForId: inv.id, totalPaisa: -inv.totalPaisa! });
    await expect(db.$transaction((tx) => issueCreditNote(tx, { invoiceId: inv.id, now: NOW, by: "staff-1", reason: "again" }))).rejects.toThrow(/already has a credit note/);
  });
});

describe("revenue rows (pure)", () => {
  it("every split adds back for awkward amounts, and a zero commission makes a zero partner share", () => {
    const s: RevenueShare = { ...share, appSales: { commissionPct: 17.5, perApp: { hotel: 33.33 } }, technologyPartner: { enabled: true, name: "x", sharePct: 12.5, appliesTo: "all", apps: [] }, effectiveFrom: "2030-01-01" };
    const lines = [7, 1_001, 35_398, -16_000, 99_999].map((net, i) => ({ id: `l${i}`, appId: i % 2 ? "hotel" : "crm", editionId: "full", kind: "subscription", saleType: "new", grossPaisa: net + 13, vatPaisa: 13, netPaisa: net }));
    for (const r of revenueRows({ lines, appSales: s.appSales, share: s, day: "2030-08-10" })) {
      expect(r.commissionPaisa + r.publisherPaisa).toBe(r.netPaisa);
      expect(r.partnerPaisa + r.sheetalNetPaisa).toBe(r.commissionPaisa);
    }
    const none = revenueRows({ lines, appSales: { commissionPct: 0, perApp: {} }, share: s, day: "2030-08-10" });
    expect(none.every((r) => r.commissionPaisa === 0 && r.partnerPaisa === 0 && r.publisherPaisa === r.netPaisa)).toBe(true);
  });
});
