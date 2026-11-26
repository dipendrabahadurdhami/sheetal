// Software packs on the business API: GET /packs (prices, offer, software, the current pack), POST /packs/quote, POST /packs/checkout paid
// with the eSewa test merchant switches on every app of the pack for the chosen length; billing rights are needed; sales off refuses.
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
const call = (who: string, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.biz! } });
const esewaAnswer = (ref: string, totalText: string) => {
  const d = { transaction_code: "0001", status: "COMPLETE", total_amount: totalText, transaction_uuid: ref, product_code: "EPAYTEST", signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
  const signature = esewaSign(ESEWA_TEST.secretKey, d.signed_field_names.split(",").map((n) => `${n}=${(d as Record<string, string>)[n]}`).join(","));
  return Buffer.from(JSON.stringify({ ...d, signature })).toString("base64");
};

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"), { fetch: fakeFetch });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, invoices, payments, app_settings, coupons, notifications, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent"]) {
    const u = await db.user.create({ data: { email: `${k}@packs.test`, userName: `pk-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Pack Realty", type: "agency", planId: "agency-business" }))).id;
  const role = (await db.role.findMany({ where: { tenantId: ids.biz } })).find((r) => !(r.perms as string[]).includes("*") && !(r.perms as string[]).some((x) => x.startsWith("workspace.billing")))!;
  await db.membership.create({ data: { tenantId: ids.biz, userId: ids.agent!, roleId: role.id, status: "active" } });
  await db.tenant.update({ where: { id: ids.biz }, data: { billingMode: "apps" } });
  await db.appSetting.create({ data: { key: BILLING_SETTING.key, value: { ...BILLING_SETTING.default, salesEnabled: true } } });
});
afterAll(async () => { await app.close(); });

describe("software packs", () => {
  it("shows the three packs with the offer, the software and no current pack; billing rights are needed", async () => {
    expect((await call("agent", "GET", "/packs")).statusCode).toBe(403);
    const d = (await call("owner", "GET", "/packs")).json().data;
    expect(d.packs.map((p: { id: string }) => p.id)).toEqual(["starter", "business", "pro"]);
    expect(d.packs[0].periods.find((x: { months: number }) => x.months === 1)).toMatchObject({ pricePaisa: 399_900, normalPaisa: 499_900, onOffer: true });
    expect(d.software.find((s: { id: string }) => s.id === "cms").free).toBe(true);
    expect(d.current).toBeNull();
  });

  it("the quote adds up to the pack price; paying switches on every app of the pack for 6 months", async () => {
    const q = (await call("owner", "POST", "/packs/quote", { packId: "business", months: 6 })).json().data;
    expect(q.errors).toEqual([]);
    expect(q.totalPaisa).toBe(4_859_900); // the Business offer for 6 months
    expect(q.lines.reduce((a: number, l: { grossPaisa: number }) => a + l.grossPaisa, 0)).toBe(q.totalPaisa);
    expect((await call("owner", "POST", "/packs/quote", { packId: "business", months: 3 })).statusCode).toBe(422);

    const c = await call("owner", "POST", "/packs/checkout", { packId: "business", months: 6, provider: "esewa" });
    expect(c.statusCode).toBe(200);
    const d = c.json().data;
    expect(d.fields.total_amount).toBe("48599.00");
    const p = await app.db!.payment.findUniqueOrThrow({ where: { id: d.paymentId } });
    const ok = await call("owner", "POST", `/billing/payments/${p.id}/verify`, { data: esewaAnswer(p.ref, rupeesText(p.amountPaisa!)) });
    expect(ok.json().data).toMatchObject({ status: "paid", kind: "subscription" });

    const subs = await app.db!.subscription.findMany({ where: { tenantId: ids.biz, currentPeriodEnd: { gt: new Date() } } });
    const apps = subs.map((s) => s.appId);
    expect(apps).toEqual(expect.arrayContaining(["crm", "invoicing", "people", "rentals", "agreements", "listings"]));
    expect(apps).not.toContain("hotel"); // Pro only
    for (const s of subs) expect(s).toMatchObject({ periodMonths: 6, status: "active" });
    // Each subscription keeps its share: a renewal adds up to the pack price again.
    expect(subs.reduce((a, s) => a + Number(s.priceGrossPaisa), 0)).toBe(4_859_900);

    const after = (await call("owner", "GET", "/packs")).json().data;
    expect(after.current).toMatchObject({ packId: "business", months: 6 });
    // The apps are paid for now: buying a pack with them again is refused.
    expect((await call("owner", "POST", "/packs/quote", { packId: "pro", months: 1 })).json().data.errors[0].en).toMatch(/already pay/);
  });

  it("refuses checkout while sales are off", async () => {
    await app.db!.appSetting.update({ where: { key: BILLING_SETTING.key }, data: { value: { ...BILLING_SETTING.default, salesEnabled: false } } });
    const r = await call("owner", "POST", "/packs/checkout", { packId: "starter", months: 1, provider: "esewa" });
    expect([r.statusCode, r.json().code]).toEqual([409, "sales_off"]);
    await app.db!.appSetting.update({ where: { key: BILLING_SETTING.key }, data: { value: { ...BILLING_SETTING.default, salesEnabled: true } } });
  });
});
