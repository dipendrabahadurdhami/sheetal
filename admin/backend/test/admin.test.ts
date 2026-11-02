import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PATCH", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });

async function person(key: string, email: string, platformRole: string | null = null) {
  const u = await app.db!.user.create({ data: { email, userName: key, platformRole, passwordHash: "x" } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, outbound_emails, audit_logs, upgrade_requests RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("boss", "admin@sheetal.test", "super_admin");
  await person("ops", "ops@sheetal.test", "operations");
  await person("help", "help@sheetal.test", "support");
  await person("owner", "owner@everest.test");
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", city: "Lalitpur" }))).id;
  await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Inn", type: "hotel", planId: "hotel-business" }));
});
afterAll(async () => { await app.close(); });

describe("staff only", () => {
  it("keeps businesses out", async () => {
    expect((await call("owner", "GET", "/admin/tenants")).statusCode).toBe(403);
    expect((await call("ops", "GET", "/admin/me")).json().data).toMatchObject({ role: "operations" });
  });
});

describe("businesses", () => {
  it("lists, searches and filters", async () => {
    expect((await call("ops", "GET", "/admin/tenants")).json().meta.total).toBe(2);
    expect((await call("ops", "GET", "/admin/tenants?q=lalit")).json().data.map((t: { name: string }) => t.name)).toEqual(["Everest Realty"]);
    expect((await call("ops", "GET", "/admin/tenants?type=hotel")).json().data[0]).toMatchObject({ name: "Lakeside Inn", plan: { name: "Business" }, members: 1 });
  });

  it("shows one business with its team", async () => {
    const d = (await call("help", "GET", `/admin/tenants/${ids.tenant}`)).json().data;
    expect(d).toMatchObject({ name: "Everest Realty", plan: { id: "agency-starter" }, members: [expect.objectContaining({ email: "owner@everest.test", role: "owner" })] });
  });

  it("suspends only with the right staff role, and records it", async () => {
    expect((await call("help", "PATCH", `/admin/tenants/${ids.tenant}`, { status: "suspended" })).statusCode).toBe(403);
    expect((await call("ops", "PATCH", `/admin/tenants/${ids.tenant}`, { status: "suspended" })).statusCode).toBe(200);
    expect((await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } })).status).toBe("suspended");
    const log = (await call("ops", "GET", `/admin/audit?tenantId=${ids.tenant}`)).json().data;
    expect(log[0]).toMatchObject({ action: "admin.tenant_updated", actor: { email: "ops@sheetal.test" } });
    await call("ops", "PATCH", `/admin/tenants/${ids.tenant}`, { status: "active" });
  });

  it("leaves auto-renew to the super admin, and checks plans fit the business type", async () => {
    expect((await call("ops", "PATCH", `/admin/tenants/${ids.tenant}`, { autoRenew: true })).statusCode).toBe(403);
    expect((await call("boss", "PATCH", `/admin/tenants/${ids.tenant}`, { autoRenew: true })).statusCode).toBe(200);
    expect((await call("boss", "PATCH", `/admin/tenants/${ids.tenant}`, { planId: "hotel-pro" })).statusCode).toBe(400);
  });
});

describe("upgrade requests", () => {
  it("lists them and, once paid, moves the business to the new plan", async () => {
    const r = await app.db!.upgradeRequest.create({ data: { tenantId: ids.tenant!, userId: ids.owner!, planId: "agency-pro", months: 12 } });
    const list = (await call("ops", "GET", "/admin/upgrades")).json().data;
    expect(list[0]).toMatchObject({ plan: { name: "Pro" }, tenant: { name: "Everest Realty" }, user: { email: "owner@everest.test" } });
    expect((await call("ops", "PATCH", `/admin/upgrades/${r.id}`, { status: "done" })).statusCode).toBe(403); // operations doesn't manage plans
    expect((await call("boss", "PATCH", `/admin/upgrades/${r.id}`, { status: "done" })).statusCode).toBe(200);
    const t = await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.tenant } });
    expect(t).toMatchObject({ planId: "agency-pro", period: 12, status: "active" });
    expect(t.renewsAt!.getTime()).toBeGreaterThan(Date.now() + 360 * 864e5);
  });
});

describe("staff", () => {
  it("adds staff with a set-password link, never a password", async () => {
    expect((await call("ops", "POST", "/admin/staff", { email: "new@sheetal.test", name: "New Person", role: "support" })).statusCode).toBe(403);
    expect((await call("boss", "POST", "/admin/staff", { email: "New@Sheetal.test", name: "New Person", role: "content_editor" })).statusCode).toBe(200);
    const mail = await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "new@sheetal.test" } });
    expect(mail.text).toContain("/reset-password/");
    const staff = (await call("boss", "GET", "/admin/staff")).json().data;
    expect(staff.find((s: { email: string }) => s.email === "new@sheetal.test")).toMatchObject({ platformRole: "content_editor", invited: true });
  });

  it("always keeps a super admin and signs out removed staff", async () => {
    expect((await call("boss", "PATCH", `/admin/staff/${ids.boss}`, { role: null })).statusCode).toBe(400);
    expect((await call("boss", "PATCH", `/admin/staff/${ids.help}`, { role: null })).statusCode).toBe(200);
    expect((await call("help", "GET", "/admin/me")).statusCode).toBe(401);
  });
});
