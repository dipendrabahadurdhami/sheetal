// Tests for the Phase 3 admin billing API (P3-BE-7; MARKETPLACE-AND-BILLING.md sections 3, 5, 11, 13 and 14.3; PHASE-3-TEST-PLAN.md suites
// 10, 11 and 14): pricing with the impact count and approval of a rise, coupons, subscriptions and staff gifts, sales and revenue in Nepal
// days, the VAT summary, and refunds with maker-checker, partial lines, ending access and the one-person team rule.
// Where it fits: runs with the admin API tests (needs the throwaway PostgreSQL): npm run test -w @sheetal/admin-api
// How it works: a real admin API; sales are made the way the business marketplace makes them (a quote, its stored invoice, a live payment
// applied with applySubscriptionPayment), so the revenue rows and tax numbers are the real ones.
// Rules: the maker never approves their own request; amounts are paisa; only live money shows in sales; CSV needs platform.billing.export.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { seedCatalog } from "@sheetal/platform/billing/catalog";
import { quote } from "@sheetal/platform/billing/quote";
import { applySubscriptionPayment, createInvoiceFromQuote } from "@sheetal/platform/billing/invoice";
import { BILLING_DEFAULTS } from "@sheetal/platform/billing/types";
import { REVENUE_SHARE_DEFAULT } from "@sheetal/platform/settings/revenue-share";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
type M = "GET" | "POST" | "PUT" | "PATCH";
const call = (who: string, method: M, url: string, body?: object) => app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
async function person(key: string, platformRole: string) {
  const u = await app.db!.user.create({ data: { email: `${key}@sheetal.test`, userName: key, platformRole, passwordHash: "x" } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const db = () => app.db!;
const SETTINGS = { ...BILLING_DEFAULTS, salesEnabled: true };

async function business(name = "Billing Hotel"): Promise<string> {
  await db().$executeRawUnsafe(`INSERT INTO plans (id, type, name, price, limits, features) VALUES ('be7-plan', 'hotel', 'Business', 1500, '{}', '{}') ON CONFLICT DO NOTHING`);
  const id = `be7-${randomUUID().slice(0, 8)}`;
  await db().$executeRawUnsafe(`INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ($1, $2, 'hotel', 'be7-plan', now())`, id, name);
  return id;
}
/** A paid app sale: apps bought monthly, paid now (or at `at`), live unless `mode` says test. */
async function sale(tenantId: string, apps: string[], o: { at?: Date; mode?: "live" | "test" } = {}) {
  const now = o.at ?? new Date();
  const q = quote({ now, business: { anchorDay: null, subscriptions: [], lock: null }, items: apps.map((appId) => ({ kind: "subscribe" as const, appId, editionId: "full", periodMonths: 1 as const })), catalog: seedCatalog(), settings: SETTINGS });
  const inv = await db().$transaction((tx) => createInvoiceFromQuote(tx, { tenantId, quote: q, by: null, billedTo: { name: "Billing Hotel" }, catalogVersion: 1 }));
  const pay = await db().payment.create({ data: { invoiceId: inv.id, tenantId, provider: "esewa", amount: Math.round(q.totalPaisa / 100), amountPaisa: BigInt(q.totalPaisa), mode: o.mode ?? "live", ref: `R-${randomUUID()}` } });
  const share = { ...REVENUE_SHARE_DEFAULT };
  const r = await db().$transaction((tx) => applySubscriptionPayment(tx, { paymentId: pay.id, now, appSales: share.appSales, share, seller: { name: "Sheetal Property" } }));
  return { inv, pay, q, number: r.number };
}
const pricing = async () => (await call("fin", "GET", "/admin/pricing")).json().data as { catalog: ReturnType<typeof seedCatalog> & { version: number }; counts: { editions: Record<string, { paying: number; free: number }> } };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  await db().$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, invoices, coupons, platform_approvals, notifications, event_outbox RESTART IDENTITY CASCADE`);
  await person("boss", "super_admin");
  await person("fin", "finance");
  await person("fin2", "finance");
  await person("ops", "operations");
});
afterAll(async () => { await app.close(); });

describe("pricing", () => {
  it("shows the catalog and who has what; only pricing staff change it, never through the generic settings route", async () => {
    expect((await call("ops", "GET", "/admin/pricing")).statusCode).toBe(403);
    const p = await call("fin", "GET", "/admin/pricing");
    expect(p.statusCode).toBe(200);
    expect(p.json().data).toMatchObject({ canChange: true, catalog: { version: 1 } });
    const r = await call("boss", "PUT", "/admin/settings/store/platform.catalog", { value: p.json().data.catalog, reason: "trying the side door" });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/Pricing screen/);
  });

  it("a price cut is saved at once with its reason; a stale version is refused", async () => {
    const { catalog } = await pricing();
    catalog.apps.agreements!.editions.full!.priceMonthPaisa = 18_000;
    expect((await call("fin", "PUT", "/admin/pricing", { catalog, reason: "x" })).statusCode).toBe(422);
    const r = await call("fin", "PUT", "/admin/pricing", { catalog, reason: "Diwali price for agreements" });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.version).toBe(2);
    expect((await pricing()).catalog.apps.agreements!.editions.full!.priceMonthPaisa).toBe(18_000);
    expect(await db().auditLog.count({ where: { action: "settings.platform.catalog", actorId: ids.fin } })).toBe(1);
    expect((await call("fin", "PUT", "/admin/pricing", { catalog, reason: "saved from an old screen" })).statusCode).toBe(409);
  });

  it("a rise that paying businesses have waits for a second staff member; the maker can't approve it", async () => {
    await sale(await business(), ["hotel"]);
    const before = await pricing();
    expect(before.counts.editions["hotel:full"]!.paying).toBe(1);
    const catalog = structuredClone(before.catalog);
    catalog.apps.hotel!.editions.full!.priceMonthPaisa = 80_000;
    const pv = await call("fin", "POST", "/admin/pricing/preview", { catalog });
    expect(pv.json().data).toMatchObject({ needsApproval: true, payingAffected: 1, approvalSkipped: false });
    const r = await call("fin", "PUT", "/admin/pricing", { catalog, reason: "Hotel costs went up" });
    expect(r.statusCode).toBe(202);
    const approvalId = r.json().data.approvalId as string;
    expect((await pricing()).catalog.apps.hotel!.editions.full!.priceMonthPaisa).toBe(70_000);
    expect(await db().notification.count({ where: { userId: ids.fin2, type: "approval" } })).toBe(1);
    const list = (await call("fin2", "GET", "/admin/approvals")).json().data as { id: string; mayDecide: boolean }[];
    expect(list.find((x) => x.id === approvalId)?.mayDecide).toBe(true);
    expect((await call("fin", "POST", `/admin/approvals/${approvalId}/decide`, { decision: "approve", note: "fine by me" })).statusCode).toBe(403);
    expect((await call("ops", "POST", `/admin/approvals/${approvalId}/decide`, { decision: "approve", note: "fine by me" })).statusCode).toBe(404);
    const ok = await call("fin2", "POST", `/admin/approvals/${approvalId}/decide`, { decision: "approve", note: "checked the costs" });
    expect(ok.statusCode).toBe(200);
    const after = await pricing();
    expect(after.catalog.apps.hotel!.editions.full!.priceMonthPaisa).toBe(80_000);
    expect(after.catalog.version).toBe(before.catalog.version + 1);
    expect(await db().platformApproval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({ status: "executed", checkerId: ids.fin2 });
    expect(await db().eventOutbox.count({ where: { name: "platform.catalog.changed" } })).toBe(2);
    expect((await call("fin2", "POST", `/admin/approvals/${approvalId}/decide`, { decision: "approve", note: "again" })).statusCode).toBe(409);
  });

  it("refuses to switch off the free edition that businesses use", async () => {
    const t = await business();
    await db().subscription.create({ data: { tenantId: t, appId: "agreements", editionId: "free", status: "active", source: "install" } });
    const { catalog } = await pricing();
    catalog.apps.agreements!.freeEditionEnabled = false;
    const r = await call("fin", "PUT", "/admin/pricing", { catalog, reason: "no more free agreements" });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/free edition/);
  });
});

describe("coupons", () => {
  it("makes, refuses a duplicate, pauses with the version, and lists uses", async () => {
    expect((await call("ops", "POST", "/admin/coupons", { code: "DASHAIN", kind: "percent", value: 10 })).statusCode).toBe(403);
    const r = await call("fin", "POST", "/admin/coupons", { code: "dashain", kind: "percent", value: 10, appliesTo: "apps", appIds: ["hotel"] });
    expect(r.statusCode).toBe(200);
    expect((await call("fin", "POST", "/admin/coupons", { code: "DASHAIN", kind: "percent", value: 5 })).statusCode).toBe(409);
    expect((await call("fin", "POST", "/admin/coupons", { code: "BAD1", kind: "percent", value: 10, appliesTo: "apps", appIds: ["nope"] })).statusCode).toBe(400);
    const id = r.json().data.id as string;
    expect((await call("fin", "PATCH", `/admin/coupons/${id}`, { version: 1, active: false })).statusCode).toBe(200);
    expect((await call("fin", "PATCH", `/admin/coupons/${id}`, { version: 1, active: true })).statusCode).toBe(409);
    const list = (await call("fin", "GET", "/admin/coupons")).json().data as { code: string; active: boolean; uses: number }[];
    expect(list).toEqual([expect.objectContaining({ code: "DASHAIN", active: false, uses: 0 })]);
    expect(await db().auditLog.count({ where: { action: { startsWith: "billing.coupon_" } } })).toBe(2);
  });
});

describe("subscriptions and gifts", () => {
  it("shows one business; gifts need platform.subscription.grant and a reason; a gift can be taken back", async () => {
    const t = await business("Gift Hotel");
    const { number } = await sale(t, ["hotel"]);
    const one = (await call("ops", "GET", `/admin/subscriptions/${t}`)).json().data;
    expect(one.subscriptions).toEqual([expect.objectContaining({ appId: "hotel", editionId: "full", status: "active", now: expect.objectContaining({ access: "full" }) })]);
    expect(one.invoices[0]).toMatchObject({ number, kind: "subscription" });
    const end = new Date(Date.now() + 30 * 864e5).toISOString();
    const body = { kind: "app", appId: "agreements", endsAt: end, reason: "Partner pilot for a month" };
    expect((await call("fin", "POST", `/admin/subscriptions/${t}/grants`, body)).statusCode).toBe(403);
    expect((await call("boss", "POST", `/admin/subscriptions/${t}/grants`, { ...body, reason: "x" })).statusCode).toBe(422);
    const g = await call("boss", "POST", `/admin/subscriptions/${t}/grants`, body);
    expect(g.statusCode).toBe(200);
    expect(await db().entitlementGrant.findUniqueOrThrow({ where: { id: g.json().data.id } })).toMatchObject({ kind: "app", appId: "agreements", key: "full", source: "staff", createdBy: ids.boss });
    expect((await call("boss", "POST", `/admin/subscriptions/${t}/grants/${g.json().data.id}/revoke`, { reason: "Pilot ended early" })).statusCode).toBe(200);
    expect((await call("boss", "POST", `/admin/subscriptions/${t}/grants/${g.json().data.id}/revoke`, { reason: "Pilot ended early" })).statusCode).toBe(400);
    expect(await db().auditLog.count({ where: { tenantId: t, action: { in: ["billing.grant_given", "billing.grant_revoked"] } } })).toBe(2);
  });

  it("extends a running trial with the version, up to 90 days in all", async () => {
    const t = await business();
    const now = Date.now();
    await db().subscription.create({ data: { tenantId: t, appId: "crm", editionId: "full", status: "trialing", trialEndsAt: new Date(now + 5 * 864e5), trialUsedAt: new Date(now - 9 * 864e5), source: "trial" } });
    const r = await call("boss", "POST", `/admin/subscriptions/${t}/crm/extend-trial`, { days: 7, version: 1, reason: "Needs more time to import" });
    expect(r.statusCode).toBe(200);
    expect(new Date(r.json().data.trialEndsAt).getTime()).toBeGreaterThan(now + 11 * 864e5);
    expect((await call("boss", "POST", `/admin/subscriptions/${t}/crm/extend-trial`, { days: 7, version: 1, reason: "Needs more time to import" })).statusCode).toBe(409);
    expect(await db().subscriptionEvent.count({ where: { tenantId: t, type: "trial_extended" } })).toBe(1);
  });
});

describe("sales and revenue in Nepal days", () => {
  it("counts live sales by the Nepal day; test payments never appear; CSV needs the export right and is audited", async () => {
    const t = await business("Revenue Hotel");
    const late = await sale(t, ["agreements"], { at: new Date("2026-11-01T18:10:00Z") }); // 23:55 on 1 November in Nepal
    const early = await sale(t, ["agreements"], { at: new Date("2026-11-01T18:20:00Z") }); // 00:05 on 2 November in Nepal
    await sale(t, ["crm"], { at: new Date("2026-11-01T12:00:00Z"), mode: "test" });
    const day1 = (await call("fin", "GET", "/admin/sales?range=custom&from=2026-11-01&to=2026-11-01")).json();
    expect(day1.data).toEqual([expect.objectContaining({ invoiceId: late.inv.id, kind: "sale", saleType: "new", method: "esewa", grossPaisa: late.q.totalPaisa, number: late.number })]);
    expect(day1.totals.grossPaisa).toBe(late.q.totalPaisa);
    const rev = (await call("fin", "GET", "/admin/revenue?range=custom&from=2026-11-01&to=2026-11-02")).json().data;
    expect(rev.totals.grossPaisa).toBe(late.q.totalPaisa + early.q.totalPaisa);
    expect(rev.totals.count).toBe(2);
    expect(rev.totals.newSalesPaisa).toBe(rev.totals.grossPaisa);
    expect(rev.totals.vatPaisa + rev.totals.netPaisa).toBe(rev.totals.grossPaisa);
    expect(rev.byDay.map((d: { key: string; totals: { count: number } }) => [d.key, d.totals.count])).toEqual([["2026-11-01", 1], ["2026-11-02", 1]]);
    expect(rev.byApp).toEqual([expect.objectContaining({ key: "agreements" })]);
    expect((await call("ops", "GET", "/admin/revenue")).statusCode).toBe(403);
    expect((await call("fin", "GET", "/admin/sales?range=custom&from=2026-11-01&to=2026-11-02&format=csv")).statusCode).toBe(403);
    const csv = await call("boss", "GET", "/admin/sales?range=custom&from=2026-11-01&to=2026-11-02&format=csv");
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body.trim().split("\r\n")).toHaveLength(3);
    expect(await db().auditLog.count({ where: { action: "billing.export", actorId: ids.boss } })).toBe(1);
  });
});

describe("refunds", () => {
  it("a part of a bundle: asked by one, approved by another; a credit note for that line only; the rest stays", async () => {
    const t = await business("Refund Hotel");
    const s = await sale(t, ["hotel", "agreements"]);
    const line = s.inv.lines.find((l) => l.appId === "agreements")!;
    const ask = await call("fin", "POST", "/admin/refunds", { paymentId: s.pay.id, lineIds: [line.id], reason: "Bought agreements by mistake" });
    expect(ask.statusCode).toBe(202);
    const id = ask.json().data.approvalId as string;
    expect(ask.json().data.amountPaisa).toBe(Number(line.grossPaisa));
    expect((await call("fin", "POST", "/admin/refunds", { paymentId: s.pay.id, lineIds: [line.id], reason: "Bought agreements by mistake" })).statusCode).toBe(409);
    expect((await call("fin", "POST", `/admin/approvals/${id}/decide`, { decision: "approve", note: "self" })).statusCode).toBe(403);
    const ok = await call("fin2", "POST", `/admin/approvals/${id}/decide`, { decision: "approve", note: "Checked with the owner" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.number).toMatch(/^CN-/);
    expect(Number((await db().payment.findUniqueOrThrow({ where: { id: s.pay.id } })).refundedPaisa)).toBe(Number(line.grossPaisa));
    const refunds = await db().revenueEntry.findMany({ where: { invoiceId: s.inv.id, kind: "refund" } });
    expect(refunds.map((r) => [r.invoiceLineId, Number(r.grossPaisa)])).toEqual([[line.id, -Number(line.grossPaisa)]]);
    // The same line again, or the whole invoice now, is refused before anyone is asked.
    expect((await call("fin", "POST", "/admin/refunds", { paymentId: s.pay.id, lineIds: [line.id], reason: "again please" })).statusCode).toBe(400);
    expect((await call("fin", "POST", "/admin/refunds", { paymentId: s.pay.id, reason: "all of it" })).statusCode).toBe(400);
    expect(await db().eventOutbox.count({ where: { tenantId: t, name: "platform.refund.executed" } })).toBe(1);
    // The money goes back by hand, then it is recorded once.
    expect((await call("fin", "POST", `/admin/refunds/${id}/sent`, { ref: "ESW-778899" })).statusCode).toBe(200);
    expect((await call("fin", "POST", `/admin/refunds/${id}/sent`, { ref: "ESW-778899" })).statusCode).toBe(409);
    const row = ((await call("fin", "GET", "/admin/refunds")).json().data as { id: string; stage: string }[]).find((x) => x.id === id);
    expect(row?.stage).toBe("money_sent");
  });

  it("a rejected refund changes nothing; a test payment is never refunded", async () => {
    const t = await business();
    const s = await sale(t, ["crm"]);
    const ask = await call("fin", "POST", "/admin/refunds", { paymentId: s.pay.id, reason: "Changed their mind" });
    expect((await call("fin2", "POST", `/admin/approvals/${ask.json().data.approvalId}/decide`, { decision: "reject", note: "Outside the policy" })).statusCode).toBe(200);
    expect(await db().invoice.count({ where: { kind: "credit", creditForId: s.inv.id } })).toBe(0);
    const test = await sale(t, ["agreements"], { mode: "test" });
    const r = await call("fin", "POST", "/admin/refunds", { paymentId: test.pay.id, reason: "test money back" });
    expect(r.statusCode).toBe(400);
  });

  it("one-person team: with nobody else to approve, it runs at once, says so, and can end the app's access", async () => {
    const t = await business();
    const s = await sale(t, ["agreements"]);
    await db().user.updateMany({ where: { id: { in: [ids.boss!, ids.fin2!] } }, data: { status: "suspended" } });
    try {
      const r = await call("fin", "POST", "/admin/refunds", { paymentId: s.pay.id, endAccess: true, reason: "Refund inside the window" });
      expect(r.statusCode).toBe(200);
      expect(r.json().data).toMatchObject({ approvalSkipped: true, whole: true, endAccess: true });
      expect(await db().platformApproval.findUniqueOrThrow({ where: { id: r.json().data.approvalId } })).toMatchObject({ status: "executed", checkerId: null });
      expect(await db().subscription.findUniqueOrThrow({ where: { tenantId_appId: { tenantId: t, appId: "agreements" } } })).toMatchObject({ editionId: "free", periodMonths: null, status: "active" });
      expect(await db().auditLog.count({ where: { action: "billing.refund_executed", tenantId: t } })).toBe(1);
    } finally {
      await db().user.updateMany({ where: { id: { in: [ids.boss!, ids.fin2!] } }, data: { status: "active" } });
    }
  });
});

describe("VAT, tax invoices, IRD and shadow mode", () => {
  it("adds up tax invoices and credit notes per Nepal month, lists them, and counts shadow differences", async () => {
    const vat = (await call("fin", "GET", "/admin/billing/vat?range=30d")).json().data as { invoices: number; creditNotes: number; vatPaisa: number; creditVatPaisa: number; netVatPaisa: number }[];
    const sum = vat.reduce((a, m) => ({ invoices: a.invoices + m.invoices, credits: a.credits + m.creditNotes }), { invoices: 0, credits: 0 });
    expect(sum.credits).toBe(2);
    expect(sum.invoices).toBeGreaterThanOrEqual(5);
    for (const m of vat) expect(m.netVatPaisa).toBe(m.vatPaisa + m.creditVatPaisa);
    expect((await call("fin", "GET", "/admin/billing/vat?range=30d&format=csv")).statusCode).toBe(403);
    const list = (await call("fin", "GET", "/admin/billing/tax-invoices?range=30d&kind=credit")).json().data as { number: string; creditFor: string | null }[];
    expect(list).toHaveLength(2);
    expect(list.every((x) => x.number.startsWith("CN-") && x.creditFor?.startsWith("INV-"))).toBe(true);
    expect((await call("fin", "GET", "/admin/billing/ird")).json()).toMatchObject({ linked: false });
    const t = await business("Shadow Hotel");
    await db().auditLog.createMany({ data: [
      { action: "billing.shadow_diff", tenantId: t, target: "2 less, 0 more" },
      { action: "billing.shadow_diff", tenantId: t, target: "0 less, 1 more" },
    ] });
    const sh = (await call("fin", "GET", "/admin/billing/shadow?days=7")).json().data;
    expect(sh).toMatchObject({ reports: 2, lessReports: 1, businesses: 1 });
  });
});
