import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-settings-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, outbound_emails, audit_logs, app_settings RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent"]) {
    const u = await db.user.create({ data: { email: `${k}@everest.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: role.id, status: "active" } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("business settings", () => {
  it("saves a section on the server and never sends a secret back", async () => {
    const pay = { mode: "own", own: { khalti: { on: true, key: "live_secret_key_123" }, fonepay: { on: true, merchant: "FP-1" } } };
    const r = await call("owner", "PUT", "/workspace/settings/payments", pay);
    expect(r.statusCode).toBe(200);
    expect(r.json().data.own.khalti.key).toBe("••••••••");
    const raw = JSON.stringify((await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.agency } })).settings);
    expect(raw).not.toContain("live_secret_key_123");
    expect((await call("owner", "GET", "/workspace/settings")).json().data.payments).toMatchObject({ mode: "own", own: { khalti: { key: "••••••••" }, fonepay: { merchant: "FP-1" } } });
    // Sending the mask back keeps the saved key.
    const sealed = raw.match(/"key":"(v1:[^"]+)"/)![1];
    await call("owner", "PUT", "/workspace/settings/payments", { ...pay, own: { ...pay.own, khalti: { on: true, key: "••••••••" } } });
    expect(JSON.stringify((await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.agency } })).settings)).toContain(sealed);
  });

  it("only lets settings people change settings, and checks check-up settings", async () => {
    expect((await call("agent", "PUT", "/workspace/settings/notifications", { dailySummary: false })).statusCode).toBe(403);
    expect((await call("owner", "PUT", "/workspace/settings/nothing", {})).statusCode).toBe(404);
    expect((await call("owner", "PUT", "/workspace/settings/checkups", { perDay: 500 })).statusCode).toBe(422);
    expect((await call("owner", "PUT", "/workspace/settings/checkups", { perDay: 4, extendMonths: 6 })).json().data).toMatchObject({ perDay: 4, extendMonths: 6, reviewers: "all" });
  });

  it("moves a listing's next check by the business's setting and keeps a history", async () => {
    const l = await app.db!.listing.create({ data: { code: "SP-0101", slug: "house-101", tenantId: ids.agency, kind: "sell", purpose: "sale", category: "House", title: "House in Dhapasi", status: "published" } });
    const r = await call("agent", "POST", "/listings/SP-0101/checkup", { action: "ok" });
    expect(r.statusCode).toBe(200);
    const due = (await app.db!.listing.findUniqueOrThrow({ where: { id: l.id } })).checkDueAt!;
    const months = (due.getUTCFullYear() - new Date().getUTCFullYear()) * 12 + due.getUTCMonth() - new Date().getUTCMonth();
    expect(months).toBe(6);
    expect((await call("agent", "POST", "/listings/SP-0101/checkup", { action: "sold" })).json().data.status).toBe("sold");
    expect((await call("owner", "GET", "/checkups/log")).json().data).toEqual(expect.arrayContaining([expect.objectContaining({ listingId: "SP-0101", action: "ok", by: "agent", title: "House in Dhapasi" })]));
  });

  it("exports and imports listings and leads", async () => {
    const imp = await call("owner", "POST", "/data/listings", { rows: [{ title: "Land in Bhaisepati", purpose: "Sale", type: "Land", district: "Lalitpur", area: "Bhaisepati", price: 9000000, land: 4 }] });
    expect(imp.statusCode).toBe(200);
    const exp = (await call("owner", "GET", "/data/listings")).json().data;
    expect(exp).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Land in Bhaisepati", purpose: "Sale", status: "draft", land: "4 Aana" })]));
    expect((await call("owner", "POST", "/data/leads", { rows: [{ name: "Rita", phone: "9815550011", source: "WhatsApp", stage: "Visit", listing: "SP-0101", budget: 30000000 }] })).statusCode).toBe(200);
    expect((await call("owner", "GET", "/data/leads")).json().data).toEqual([expect.objectContaining({ name: "Rita", source: "WhatsApp", stage: "Visit", listing: "SP-0101", budget: 30000000 })]);
    expect((await call("owner", "POST", "/data/stock", { rows: [{}] })).statusCode).toBe(404);
  });

  it("sends the listing options staff changed", async () => {
    await app.db!.appSetting.create({ data: { key: "catalog", value: { lists: { facilities: [{ id: "solar", en: "Solar", ne: "सोलार" }] } } } });
    expect((await call("owner", "GET", "/catalog")).json().data.lists.facilities).toHaveLength(1);
  });
});
