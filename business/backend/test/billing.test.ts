import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { ESEWA_TEST, esewaSign } from "@sheetal/backend-core/lib/payments";
import { Vault } from "@sheetal/platform/auth/vault";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-billing-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
// The gateways' status APIs, faked: tests set what they answer.
let gatewayAnswer: unknown = { status: "COMPLETE", ref_id: "ESW-REF" };
const fakeFetch = (async (url: string | URL) => {
  if (String(url).includes("epayment/initiate")) return new Response(JSON.stringify({ pidx: "PIDX1", payment_url: "https://test-pay.khalti.com/?pidx=PIDX1" }), { status: 200 });
  return new Response(JSON.stringify(gatewayAnswer), { status: 200 });
}) as typeof fetch;

const call = (who: string, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.tenant! } });
async function person(key: string, email: string) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const esewaAnswer = (ref: string, total: number) => {
  const d = { transaction_code: "0001", status: "COMPLETE", total_amount: `${total}.0`, transaction_uuid: ref, product_code: "EPAYTEST", signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
  const signature = esewaSign(ESEWA_TEST.secretKey, d.signed_field_names.split(",").map((n) => `${n}=${(d as Record<string, string>)[n]}`).join(","));
  return Buffer.from(JSON.stringify({ ...d, signature })).toString("base64");
};

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"), { fetch: fakeFetch });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, invoices, payments, app_settings, notifications, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("owner", "owner@everest.test");
  await person("agent", "agent@everest.test");
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", email: "hello@everest.test" }))).id;
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ids.tenant, key: "agent" } });
  await db.membership.create({ data: { tenantId: ids.tenant, userId: ids.agent!, roleId: role.id, status: "active" } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("billing", () => {
  it("shows the plan, prices and the ways to pay; only billing managers pay", async () => {
    const d = (await call("owner", "GET", "/billing")).json().data;
    expect(d.plan).toMatchObject({ id: "agency-starter", price: 0 });
    expect(d.methods.map((m: { id: string }) => m.id)).toEqual(["esewa", "manual"]); // test merchant outside production
    expect(d.plans.find((p: { id: string }) => p.id === "agency-pro").periods[3]).toEqual({ months: 12, save: 39, total: Math.round(3000 * 12 * 0.61) });
    expect((await call("agent", "POST", "/billing/checkout", { provider: "esewa", planId: "agency-pro", months: 1 })).statusCode).toBe(403);
  });

  it("pays with eSewa: signed form, verified return, plan applied once, VAT on the invoice", async () => {
    const c = (await call("owner", "POST", "/billing/checkout", { provider: "esewa", planId: "agency-pro", months: 1 })).json().data;
    expect(c).toMatchObject({ method: "form", fields: { total_amount: "3000", product_code: "EPAYTEST" } });
    expect(c.fields.success_url).toBe(`https://sheetal.test/business/billing/return/esewa/${c.paymentId}`);
    const p = await app.db!.payment.findUniqueOrThrow({ where: { id: c.paymentId }, include: { invoice: true } });
    expect(p.invoice).toMatchObject({ total: 3000, vat: 345, subtotal: 2655, status: "open" });

    // A forged return is refused.
    expect((await call("owner", "POST", `/billing/payments/${c.paymentId}/verify`, { data: esewaAnswer(p.ref, 30) })).json().data.status).toBe("failed");
    const c2 = (await call("owner", "POST", "/billing/checkout", { provider: "esewa", invoiceId: p.invoiceId })).json().data;
    const p2 = await app.db!.payment.findUniqueOrThrow({ where: { id: c2.paymentId } });
    const ok = await call("owner", "POST", `/billing/payments/${c2.paymentId}/verify`, { data: esewaAnswer(p2.ref, 3000) });
    expect(ok.json()).toMatchObject({ data: { status: "paid" } });
    const t = await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } });
    expect(t).toMatchObject({ planId: "agency-pro", period: 1, status: "active" });
    expect(t.renewsAt!.getTime()).toBeGreaterThan(Date.now() + 27 * 864e5);
    // Coming back again doesn't extend anything.
    await call("owner", "POST", `/billing/payments/${c2.paymentId}/verify`, { data: esewaAnswer(p2.ref, 3000) });
    expect((await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } })).renewsAt).toEqual(t.renewsAt);
    expect(await app.db!.outboundEmail.count({ where: { subject: { startsWith: "Payment received" } } })).toBe(1);
  });

  it("renewing the same plan adds the months after the current period", async () => {
    const before = (await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } })).renewsAt!;
    const c = (await call("owner", "POST", "/billing/checkout", { provider: "esewa", planId: "agency-pro", months: 3 })).json().data;
    const p = await app.db!.payment.findUniqueOrThrow({ where: { id: c.paymentId } });
    gatewayAnswer = { status: "COMPLETE", ref_id: "R2" };
    await call("owner", "POST", `/billing/payments/${c.paymentId}/verify`, { data: esewaAnswer(p.ref, p.amount) });
    const after = (await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } })).renewsAt!;
    expect(Math.round((after.getTime() - before.getTime()) / 864e5)).toBeGreaterThanOrEqual(89);
  });

  it("uses Khalti once its key is saved, checking the payment with Khalti", async () => {
    const vault = new Vault(undefined, false);
    await app.db!.appSetting.upsert({ where: { key: "payments" }, create: { key: "payments", value: { khalti: { enabled: true, mode: "test", secretKey: vault.seal("test_secret_key") } } }, update: { value: { khalti: { enabled: true, mode: "test", secretKey: vault.seal("test_secret_key") } } } });
    const c = (await call("owner", "POST", "/billing/checkout", { provider: "khalti", planId: "agency-business", months: 1 })).json().data;
    expect(c).toMatchObject({ method: "redirect", url: expect.stringContaining("khalti"), providerRef: "PIDX1" });
    gatewayAnswer = { status: "Completed", total_amount: 1500 * 100, transaction_id: "KT1" };
    expect((await call("owner", "POST", `/billing/payments/${c.paymentId}/verify`, { pidx: "PIDX1" })).json().data.status).toBe("paid");
    expect((await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } })).planId).toBe("agency-business");
  });

  it("takes a bank transfer proof for Sheetal to check", async () => {
    const c = (await call("owner", "POST", "/billing/checkout", { provider: "manual", planId: "agency-pro", months: 12 })).json().data;
    expect(c).toMatchObject({ method: "manual", amount: Math.round(3000 * 12 * 0.61) });
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
    expect((await call("owner", "POST", `/billing/payments/${c.paymentId}/proof`, { data: png.toString("base64"), reference: "NIC-778" })).statusCode).toBe(200);
    expect(await app.db!.payment.findUniqueOrThrow({ where: { id: c.paymentId } })).toMatchObject({ status: "pending_review", providerRef: "NIC-778" });
    expect((await call("owner", "POST", `/billing/payments/${c.paymentId}/proof`, { data: png.toString("base64") })).statusCode).toBe(400);
  });
});
