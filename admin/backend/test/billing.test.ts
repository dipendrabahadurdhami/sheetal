import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { createInvoice, runBillingCycle } from "@sheetal/backend-core/domain/billing";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
async function person(key: string, email: string, platformRole: string | null = null) {
  const u = await app.db!.user.create({ data: { email, userName: key, platformRole, passwordHash: "x" } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const DAY = 864e5;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, invoices, payments, app_settings, notifications, outbound_emails, audit_logs, page_views RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("boss", "admin@sheetal.test", "super_admin");
  await person("finance", "finance@sheetal.test", "finance");
  await person("ops", "ops@sheetal.test", "operations");
  await person("owner", "owner@everest.test");
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency" }))).id;
});
afterAll(async () => { await app.close(); });

describe("bank transfers", () => {
  it("lets finance confirm a proof, which applies the plan", async () => {
    const db = app.db!;
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ids.tenant } });
    const inv = await createInvoice(db, { tenant: t, plan: (await db.plan.findUniqueOrThrow({ where: { id: "agency-business" } })), months: 6, vatRate: 13 });
    const p = await db.payment.create({ data: { invoiceId: inv.id, tenantId: t.id, provider: "manual", amount: inv.total, ref: "SPTEST1", status: "pending_review" } });
    expect((await call("finance", "GET", "/admin/billing/summary")).json().data).toMatchObject({ toCheck: 1, thisMonth: 0 });
    expect((await call("ops", "POST", `/admin/billing/payments/${p.id}/review`, { decision: "confirm" })).statusCode).toBe(403);
    expect((await call("finance", "POST", `/admin/billing/payments/${p.id}/review`, { decision: "reject" })).statusCode).toBe(400);
    expect((await call("finance", "POST", `/admin/billing/payments/${p.id}/review`, { decision: "confirm" })).statusCode).toBe(200);
    expect(await db.tenant.findUniqueOrThrow({ where: { id: ids.tenant } })).toMatchObject({ planId: "agency-business", period: 6 });
    expect((await call("finance", "GET", "/admin/billing/summary")).json().data).toMatchObject({ thisMonth: inv.total, payingBusinesses: 1, mrr: 1500 });
    expect((await call("finance", "POST", `/admin/billing/payments/${p.id}/refund`, { note: "Paid twice" })).statusCode).toBe(200);
  });
});

describe("payment keys", () => {
  it("are write-only and only the super admin changes them", async () => {
    const body = { esewa: { enabled: true, mode: "live", productCode: "NP-ES-SHEETAL", secretKey: "real-esewa-secret" }, khalti: { enabled: false, mode: "test" }, fonepay: { enabled: false, mode: "test" }, manual: { enabled: true } };
    expect((await call("finance", "PUT", "/admin/settings/payments", body)).statusCode).toBe(403);
    expect((await call("boss", "PUT", "/admin/settings/payments", { ...body, khalti: { enabled: true, mode: "test" } })).statusCode).toBe(400);
    expect((await call("boss", "PUT", "/admin/settings/payments", body)).statusCode).toBe(200);
    const got = await call("boss", "GET", "/admin/settings/payments");
    expect(got.json().data.esewa).toEqual({ enabled: true, mode: "live", productCode: "NP-ES-SHEETAL", hasSecret: true });
    expect(got.body).not.toContain("real-esewa-secret");
    const raw = JSON.stringify((await app.db!.appSetting.findUniqueOrThrow({ where: { key: "payments" } })).value);
    expect(raw).not.toContain("real-esewa-secret");
    // Saving again without a new secret keeps the old one.
    expect((await call("boss", "PUT", "/admin/settings/payments", { ...body, esewa: { ...body.esewa, secretKey: undefined } })).statusCode).toBe(200);
    expect((await call("boss", "GET", "/admin/settings/payments")).json().data.esewa.hasSecret).toBe(true);
  });
});

describe("AI and Meta settings, analytics, status", () => {
  it("keeps the AI and Meta keys write-only and super-admin only", async () => {
    expect((await call("finance", "PUT", "/admin/settings/ai", { enabled: true, model: "claude-opus-5-5", apiKey: "sk-ant-test-key-1234567890" })).statusCode).toBe(403);
    expect((await call("boss", "PUT", "/admin/settings/ai", { enabled: true, model: "gpt-4", apiKey: "sk-ant-test-key-1234567890" })).statusCode).toBe(422);
    expect((await call("boss", "PUT", "/admin/settings/ai", { enabled: true, model: "claude-opus-5-5", apiKey: "sk-ant-test-key-1234567890", credits: { Business: 3000 } })).statusCode).toBe(200);
    const ai = await call("boss", "GET", "/admin/settings/ai");
    expect(ai.json().data).toMatchObject({ enabled: true, model: "claude-opus-5-5", hasKey: true, credits: { Starter: 500, Business: 3000 } });
    expect(ai.body).not.toContain("sk-ant");
    expect((await call("boss", "PUT", "/admin/settings/meta", { appSecret: "meta-app-secret-123456", verifyToken: "verify-token-123" })).statusCode).toBe(200);
    expect((await call("boss", "GET", "/admin/settings/meta")).json().data).toMatchObject({ hasAppSecret: true, hasVerifyToken: true, webhookUrl: expect.stringContaining("/v1/webhooks/meta") });
    expect(JSON.stringify((await app.db!.appSetting.findMany()).map((s) => s.value))).not.toMatch(/sk-ant|meta-app-secret/);
  });

  it("shows analytics and system status", async () => {
    await app.db!.pageView.createMany({ data: [{ session: "s1", path: "/" }, { session: "s1", path: "/rent" }, { session: "s2", path: "/" }] });
    expect((await call("finance", "GET", "/admin/analytics")).json().data).toMatchObject({ visitors: 2, views: 3, topPages: [{ path: "/", views: 2 }, { path: "/rent", views: 1 }] });
    const s = (await call("boss", "GET", "/admin/system/status")).json().data;
    expect(s).toMatchObject({ database: { ok: true }, ai: { configured: true }, meta: { configured: true } });
    expect((await call("finance", "GET", "/admin/system/status")).statusCode).toBe(403);
  });
});

describe("renewal cycle", () => {
  it("reminds with an invoice, goes past due, then moves to Starter after the grace period", async () => {
    const db = app.db!;
    await db.invoice.updateMany({ data: { status: "void" } });
    const renews = new Date(Date.now() + 5 * DAY);
    await db.tenant.update({ where: { id: ids.tenant }, data: { planId: "agency-pro", period: 1, renewsAt: renews, status: "active", remindedFor: null } });
    const site = { siteUrl: "https://sheetal.test" };

    expect(await runBillingCycle(db, app.mailer, { ...site, now: new Date() })).toMatchObject({ reminded: 1 });
    expect(await runBillingCycle(db, app.mailer, { ...site, now: new Date() })).toMatchObject({ reminded: 0 }); // once per reminder
    expect(await db.invoice.count({ where: { tenantId: ids.tenant, status: "open", planId: "agency-pro" } })).toBe(1);
    expect(await runBillingCycle(db, app.mailer, { ...site, now: new Date(renews.getTime() - 0.5 * DAY) })).toMatchObject({ reminded: 1 }); // the 1-day one

    expect(await runBillingCycle(db, app.mailer, { ...site, now: new Date(renews.getTime() + 1000) })).toMatchObject({ pastDue: 1 });
    const due = await db.tenant.findUniqueOrThrow({ where: { id: ids.tenant } });
    expect(due.status).toBe("past_due");
    expect(Math.round((due.graceUntil!.getTime() - renews.getTime()) / DAY)).toBe(7);

    expect(await runBillingCycle(db, app.mailer, { ...site, now: new Date(renews.getTime() + 8 * DAY) })).toMatchObject({ downgraded: 1 });
    expect(await db.tenant.findUniqueOrThrow({ where: { id: ids.tenant } })).toMatchObject({ planId: "agency-starter", status: "active", renewsAt: null });
    expect(await db.invoice.count({ where: { tenantId: ids.tenant, status: "open" } })).toBe(0);
    expect(await db.notification.count({ where: { userId: ids.owner, type: "billing" } })).toBeGreaterThanOrEqual(4);
  });
});
