import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { applyPayment, createInvoice } from "@sheetal/backend-core/domain/billing";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST", url: string, body?: object, tenant = ids.agency) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant! } });
async function pay(invoiceId: string) {
  const i = await app.db!.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const p = await app.db!.payment.create({ data: { invoiceId, tenantId: i.tenantId, provider: "manual", amount: i.total, ref: `T${Date.now()}${Math.random()}` } });
  await applyPayment(app.db!, app.mailer, { paymentId: p.id, siteUrl: "https://sheetal.test" });
}
const limits = async () => { const t = await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.agency }, include: { plan: true } }); return (await effectiveLimits(app.db!, t.id, t.plan)).limits as Record<string, number>; };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, invoices, payments, tenant_addons RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent"]) {
    const u = await db.user.create({ data: { email: `${k}@himal.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Himal Realty", type: "agency", planId: "agency-business", period: 1, renewsAt: new Date(Date.now() + 75 * 864e5) }))).id;
  ids.free = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Himal Free", type: "agency" }))).id;
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: role.id, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("add-ons", () => {
  it("shows what this business can buy, and keeps Starter and people without billing out", async () => {
    const d = (await call("owner", "GET", "/billing/addons")).json().data;
    expect(d).toMatchObject({ paid: true, canBuy: true, monthsLeft: 3 });
    expect(d.addons.map((a: { id: string }) => a.id)).toEqual(["seats", "listings", "featured"]); // no POS outlets for an agency
    expect(d.addons[0]).toMatchObject({ planLimit: 10, extra: 0, qty: 0, nowPrice: 900 });
    expect((await call("agent", "POST", "/billing/addons", { addonId: "seats", qty: 1 })).statusCode).toBe(403);
    expect((await call("owner", "POST", "/billing/addons", { addonId: "seats", qty: 1 }, ids.free)).statusCode).toBe(400);
    expect((await call("owner", "POST", "/billing/addons", { addonId: "outlets", qty: 1 })).statusCode).toBe(404);
    expect((await call("owner", "POST", "/billing/addons", { addonId: "seats", qty: 0 })).statusCode).toBe(422);
  });

  it("raises the limits only once the add-on invoice is paid", async () => {
    const r = await call("owner", "POST", "/billing/addons", { addonId: "seats", qty: 2 });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.total).toBe(2 * 300 * 3); // 2 seats, Rs. 300 a month, 3 months to the renewal
    expect((await limits()).seats).toBe(10);
    await pay(r.json().data.invoiceId);
    await pay(r.json().data.invoiceId); // paying twice changes nothing
    expect((await limits()).seats).toBe(12);
    const listings = await call("owner", "POST", "/billing/addons", { addonId: "listings", qty: 1 });
    await pay(listings.json().data.invoiceId);
    expect((await call("owner", "GET", "/listings?page=1")).json().meta.cap).toBe(175);
    const t = await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.agency } });
    expect(t.planId).toBe("agency-business"); // the plan and its dates stay as they were
  });

  it("renews the add-ons with the plan, and drops the ones the business stopped", async () => {
    const db = app.db!;
    expect((await call("owner", "POST", "/billing/addons/listings/renew", { renewQty: 0 })).statusCode).toBe(200);
    expect((await call("owner", "POST", "/billing/addons/seats/renew", { renewQty: 5 })).statusCode).toBe(400);
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ids.agency } });
    const plan = await db.plan.findUniqueOrThrow({ where: { id: "agency-business" } });
    const renewal = await createInvoice(db, { tenant: t, plan, months: 1, vatRate: 13 });
    expect(renewal.total).toBe(1500 + 2 * 300); // the plan and the 2 seats kept; the listings pack stopped
    expect((await limits()).listings).toBe(175); // still paid until the renewal
    await pay(renewal.id);
    expect(await limits()).toMatchObject({ seats: 12, listings: 150 });
  });
});
