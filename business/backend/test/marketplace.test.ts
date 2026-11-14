// The business marketplace API (P3-BE-6): install a free app, one trial per business per app (and per owner), the cart quote equals the stored
// invoice, checkout with the eSewa test merchant applies the subscription with a tax invoice number, a coupon once per business, change,
// cancel, resume and remove, the overview; every route needs workspace.billing.manage; a business on today's plans gets 409 billing_mode;
// a business can never pay another business's invoice.
// Where it fits: runs with the business API tests (throwaway PostgreSQL): npm run test -w @sheetal/business-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { BILLING_SETTING } from "@sheetal/platform/billing/catalog";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { ESEWA_TEST, esewaSign, rupeesText } from "@sheetal/backend-core/lib/payments";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const fakeFetch = (async () => new Response(JSON.stringify({ status: "COMPLETE", ref_id: "ESW-REF" }), { status: 200 })) as typeof fetch;
const call = (who: string, method: "GET" | "POST", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });
const esewaAnswer = (ref: string, totalText: string) => {
  const d = { transaction_code: "0001", status: "COMPLETE", total_amount: totalText, transaction_uuid: ref, product_code: "EPAYTEST", signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
  const signature = esewaSign(ESEWA_TEST.secretKey, d.signed_field_names.split(",").map((n) => `${n}=${(d as Record<string, string>)[n]}`).join(","));
  return Buffer.from(JSON.stringify({ ...d, signature })).toString("base64");
};
const cart = (...items: object[]) => ({ items });
const HOTEL_MONTH = { kind: "subscribe", appId: "hotel", editionId: "full", periodMonths: 1 };
const CRM_MONTH = { kind: "subscribe", appId: "crm", editionId: "full", periodMonths: 1 };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"), { fetch: fakeFetch });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, invoices, payments, app_settings, coupons, notifications, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@market.test`, userName: `mk-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Market Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.biz2 = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Second Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Hotel", type: "hotel", planId: "hotel-business" }))).id;
  // A team role without billing rights.
  const role = (await db.role.findMany({ where: { tenantId: ids.biz } })).find((r) => !(r.perms as string[]).includes("*") && !(r.perms as string[]).some((x) => x.startsWith("workspace.billing")))!;
  await db.membership.create({ data: { tenantId: ids.biz, userId: ids.agent!, roleId: role.id, status: "active" } });
  await db.tenant.updateMany({ where: { id: { in: [ids.biz!, ids.biz2!, ids.otherBiz!] } }, data: { billingMode: "apps" } });
  await db.appSetting.create({ data: { key: BILLING_SETTING.key, value: { ...BILLING_SETTING.default, salesEnabled: true } } });
});
afterAll(async () => { await app.close(); });

describe("guards", () => {
  it("every route needs workspace.billing.manage; a business on today's plans gets 409 billing_mode", async () => {
    for (const [m, u, b] of [["GET", "/marketplace"], ["GET", "/billing/overview"], ["POST", "/subscriptions/quote", cart(HOTEL_MONTH)], ["POST", "/subscriptions/hotel/install"], ["POST", "/subscriptions/hotel/trial"]] as const) {
      expect((await call("agent", m, u, b as object | undefined)).statusCode, u).toBe(403);
    }
    await app.db!.tenant.update({ where: { id: ids.biz }, data: { billingMode: "plans" } });
    expect((await call("owner", "GET", "/marketplace")).json().data.mode).toBe("plans"); // reading works in every mode
    const r = await call("owner", "POST", "/subscriptions/quote", cart(HOTEL_MONTH));
    expect([r.statusCode, r.json().code]).toEqual([409, "billing_mode"]);
    await app.db!.tenant.update({ where: { id: ids.biz }, data: { billingMode: "apps" } });
  });
});

describe("free apps and trials", () => {
  it("installs a free app once, and removing keeps everything", async () => {
    expect((await call("owner", "POST", "/subscriptions/crm/install")).statusCode).toBe(200);
    expect((await call("owner", "POST", "/subscriptions/crm/install")).json().code).toBe("already_installed");
    expect((await call("owner", "POST", "/subscriptions/mail/install")).statusCode).toBe(400); // no free edition
    expect((await call("owner", "POST", "/subscriptions/payroll/install")).statusCode).toBe(404); // coming soon
    const m = (await call("owner", "GET", "/marketplace")).json().data;
    expect(m.mine.crm).toMatchObject({ installed: true, access: "full", edition: "free" });
    expect(m.catalog.apps.find((a: { id: string }) => a.id === "hotel").editions[1].priceMonthPaisa).toBe(70_000);
  });
  it("one trial per business per app, and not again for the same owner's other business", async () => {
    const r = await call("owner", "POST", "/subscriptions/reviews/trial");
    expect(r.statusCode).toBe(200);
    expect((await call("owner", "GET", "/marketplace")).json().data.mine.reviews).toMatchObject({ status: "trialing", access: "full", edition: "full", trialUsed: true });
    expect((await call("owner", "POST", "/subscriptions/reviews/trial")).json().code).toBe("trial_used");
    expect((await call("owner", "POST", "/subscriptions/reviews/trial", {}, ids.biz2)).json().code).toBe("trial_used");
    expect((await call("other", "POST", "/subscriptions/reviews/trial", {}, ids.otherBiz)).statusCode).toBe(200); // another owner may
    expect((await call("owner", "POST", "/subscriptions/reviews/cancel")).statusCode).toBe(200);
    expect((await call("owner", "GET", "/marketplace")).json().data.mine.reviews).toMatchObject({ access: "limited", edition: "free" }); // back on the free edition
  });
});

describe("the cart and checkout", () => {
  it("the quote is the invoice; paying with the eSewa test merchant applies it with a tax invoice number", async () => {
    const q = (await call("owner", "POST", "/subscriptions/quote", cart(HOTEL_MONTH, CRM_MONTH))).json().data;
    expect(q.errors).toEqual([]);
    expect(q.totalPaisa).toBe(70_000 + 30_000);
    const c = await call("owner", "POST", "/subscriptions/checkout", { ...cart(HOTEL_MONTH, CRM_MONTH), provider: "esewa" });
    expect(c.statusCode).toBe(200);
    const d = c.json().data;
    expect(d.fields.total_amount).toBe("1000.00");
    const inv = await app.db!.invoice.findUniqueOrThrow({ where: { id: d.invoiceId }, include: { lines: { orderBy: { sort: "asc" } } } });
    expect(inv.lines.map((l) => [l.appId, Number(l.grossPaisa), Number(l.vatPaisa)])).toEqual(q.lines.map((l: { appId: string; grossPaisa: number; vatPaisa: number }) => [l.appId, l.grossPaisa, l.vatPaisa]));
    expect(Number(inv.totalPaisa)).toBe(q.totalPaisa);
    const p = await app.db!.payment.findUniqueOrThrow({ where: { id: d.paymentId } });
    // One paisa off is refused; the exact amount is applied.
    expect((await call("owner", "POST", `/billing/payments/${p.id}/verify`, { data: esewaAnswer(p.ref, "999.99") })).json().data.status).toBe("failed");
    const c2 = (await call("owner", "POST", "/subscriptions/invoices/pay", { invoiceId: d.invoiceId, provider: "esewa" })).json().data;
    const p2 = await app.db!.payment.findUniqueOrThrow({ where: { id: c2.paymentId } });
    expect(p2.mode).toBe("test"); // the public test merchant: never revenue
    const ok = await call("owner", "POST", `/billing/payments/${p2.id}/verify`, { data: esewaAnswer(p2.ref, rupeesText(p2.amountPaisa!)) });
    expect(ok.json()).toMatchObject({ message: "Paid. Thank you! Your apps are ready.", data: { status: "paid", kind: "subscription" } });
    const ov = (await call("owner", "GET", "/billing/overview")).json().data;
    expect(ov.invoices[0]).toMatchObject({ status: "paid", totalPaisa: 100_000 });
    expect(ov.invoices[0].number).toMatch(/^INV-\d{4}-\d{2}-\d{4}$/);
    expect(ov.subscriptions.find((s: { appId: string }) => s.appId === "hotel")).toMatchObject({ editionId: "full", status: "active", periodMonths: 1 });
    expect(await app.db!.revenueEntry.count({ where: { invoiceId: d.invoiceId } })).toBe(0);
    // Buying the same app again is refused (change its edition instead).
    expect((await call("owner", "POST", "/subscriptions/quote", cart(HOTEL_MONTH))).json().data.errors[0].en).toMatch(/already pay/);
  });
  it("a business can't pay another business's invoice", async () => {
    const mine = await app.db!.invoice.findFirstOrThrow({ where: { tenantId: ids.biz, kind: "subscription" } });
    expect((await call("other", "POST", "/subscriptions/invoices/pay", { invoiceId: mine.id, provider: "esewa" }, ids.otherBiz)).statusCode).toBe(404);
  });
  it("a coupon: checked, then used once per business; a 100% coupon applies at once without a tax number", async () => {
    await app.db!.coupon.create({ data: { code: "FREEHOTEL", kind: "percent", value: 100, createdBy: "staff" } });
    const one = { kind: "subscribe", appId: "hotel", editionId: "full", periodMonths: 1 };
    expect((await call("owner", "POST", "/coupons/check", { ...cart(one), couponCode: "freehotel" }, ids.biz2)).json().data).toMatchObject({ ok: true, totalPaisa: 0 });
    const r = await call("owner", "POST", "/subscriptions/checkout", { ...cart(one), couponCode: "FREEHOTEL", provider: "esewa" }, ids.biz2);
    expect(r.json()).toMatchObject({ data: { paid: true } });
    const inv = await app.db!.invoice.findUniqueOrThrow({ where: { id: r.json().data.invoiceId } });
    expect([inv.status, inv.no]).toEqual(["paid", null]);
    expect((await call("owner", "POST", "/coupons/check", { ...cart({ ...one, appId: "crm" }), couponCode: "FREEHOTEL" }, ids.biz2)).json().data).toMatchObject({ ok: false });
    expect((await call("owner", "POST", "/subscriptions/checkout", { ...cart(one), couponCode: "NOPE", provider: "esewa" })).statusCode).toBe(400);
  });
});

describe("changing a subscription", () => {
  it("an upgrade needs payment, a downgrade waits; cancel, resume, and remove only after the paid period", async () => {
    const up = await call("owner", "POST", "/subscriptions/hotel/change", { editionId: "full", periodMonths: 12 });
    expect([up.statusCode, up.json().code]).toEqual([402, "payment_needed"]);
    expect((await call("owner", "POST", "/subscriptions/hotel/remove")).statusCode).toBe(400); // still paid
    expect((await call("owner", "POST", "/subscriptions/hotel/cancel")).json().message).toMatch(/nothing renews/);
    expect((await app.db!.subscription.findUniqueOrThrow({ where: { tenantId_appId: { tenantId: ids.biz!, appId: "hotel" } } })).cancelAtPeriodEnd).toBe(true);
    expect((await call("owner", "POST", "/subscriptions/hotel/resume")).json().message).toMatch(/renews as before/);
    expect((await call("owner", "POST", "/subscriptions/crm/remove")).statusCode).toBe(400); // crm is paid too now
    expect((await call("owner", "POST", "/subscriptions/reviews/remove")).json().message).toMatch(/Nothing was deleted/);
    expect((await call("owner", "GET", "/marketplace")).json().data.mine.reviews.installed).toBe(false);
    expect(await app.db!.subscriptionEvent.count({ where: { tenantId: ids.biz, type: { in: ["installed", "trial_started", "purchased", "cancelled", "resumed", "removed"] } } })).toBeGreaterThanOrEqual(6);
  });
  it("sales switched off: no checkout", async () => {
    await app.db!.appSetting.update({ where: { key: BILLING_SETTING.key }, data: { value: { ...BILLING_SETTING.default, salesEnabled: false } } });
    const r = await call("owner", "POST", "/subscriptions/checkout", { ...cart({ kind: "subscribe", appId: "pos", editionId: "full", periodMonths: 1 }), provider: "esewa" });
    expect([r.statusCode, r.json().code]).toEqual([409, "sales_off"]);
  });
});
