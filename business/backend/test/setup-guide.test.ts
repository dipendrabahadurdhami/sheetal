import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent"]) {
    const u = await db.user.create({ data: { email: `${k}@guide.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Guide Realty", type: "agency", startOnApps: true }))).id;
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: role.id, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("the guided setup", () => {
  it("starts on the basics and shows every first step as not done", async () => {
    const t = await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.agency! }, include: { subscriptions: true } });
    expect(t.billingMode).toBe("apps");
    expect(t.subscriptions.map((s) => s.appId).sort()).toEqual(["crm", "expenses", "invoicing", "listings", "people"]);
    const r = (await call("owner", "GET", "/setup")).json().data;
    expect(r).toMatchObject({ type: "agency", done: 0, total: 3, complete: false, hidden: false, tourSeen: false });
    expect(r.steps.map((s: { id: string }) => s.id)).toEqual(["details", "logo", "first", "team", "email", "verify", "apps"]);
  });

  it("ticks a step when the real data is there", async () => {
    await app.db!.tenant.update({ where: { id: ids.agency! }, data: { phone: "9800000000", address: "Baneshwor", city: "Kathmandu", logoUrl: "/brand/x.png" } });
    const r = (await call("owner", "GET", "/setup")).json().data;
    expect(r.steps.filter((s: { done: boolean }) => s.done).map((s: { id: string }) => s.id)).toEqual(["details", "logo", "team"]);
    expect(r.done).toBe(2);
  });

  it("remembers hiding the guide and the tour, for the owner only", async () => {
    expect((await call("agent", "POST", "/setup/state", { hidden: true })).statusCode).toBe(403);
    const r = (await call("owner", "POST", "/setup/state", { hidden: true, tourSeen: true })).json().data;
    expect(r).toMatchObject({ hidden: true, tourSeen: true });
    expect((await call("owner", "GET", "/setup")).json().data).toMatchObject({ hidden: true, tourSeen: true });
    expect((await call("owner", "POST", "/setup/state", { hidden: false })).json().data).toMatchObject({ hidden: false, tourSeen: true });
  });
});
