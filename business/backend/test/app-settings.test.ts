// Business → Settings → Apps (P2-W6 leftover "Settings tab per app"): the business-scope settings of the app manifests, read and changed through the
// typed settings store. Pins: the owner sees Expenses' "Ask for approval above (Rs.)"; a change is saved with its audit line and only for this business
// (another business still has the default); a wrong value is a 422 with the field's reason and saves nothing; an unknown key is 404; someone without
// workspace.settings.update reads but can't change (403); a read-only support session can't change.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { SettingsService } from "@sheetal/platform/settings/service";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { AppSettingsService, schemaOf } from "@sheetal/app-workspace/backend/app-settings.service";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const KEY = "expenses.approval.limit";
const call = (who: string, method: "GET" | "PUT", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.agency! } });
const valueOf = async (who: string, tenant?: string) => {
  const r = await call(who, "GET", "/workspace/app-settings", undefined, tenant);
  expect(r.statusCode).toBe(200);
  const d = r.json().data as { apps: { app: string; settings: { key: string; value: unknown; stored: boolean }[] }[]; canEdit: boolean };
  return { canEdit: d.canEdit, s: d.apps.find((a) => a.app === "expenses")?.settings.find((x) => x.key === KEY) };
};

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, app_settings RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent", "stranger"]) {
    const u = await db.user.create({ data: { email: `${k}@app-settings.test`, userName: `as-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.other = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.stranger!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  const agent = await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: agent.id, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("the per-app settings tab", () => {
  it("lists Expenses' setting with its default for the owner", async () => {
    const { canEdit, s } = await valueOf("owner");
    expect(canEdit).toBe(true);
    expect(s).toMatchObject({ key: KEY, value: null, stored: false });
  });

  it("saves a change with its audit line, for this business only", async () => {
    const r = await call("owner", "PUT", `/workspace/app-settings/${KEY}`, { value: 25000 });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual({ key: KEY, value: 25000 });
    expect((await valueOf("owner")).s).toMatchObject({ value: 25000, stored: true });
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.agency, action: `settings.${KEY}`, actorId: ids.owner } })).toBe(1);
    expect((await valueOf("stranger", ids.other)).s).toMatchObject({ value: null, stored: false });   // the other business keeps the default
  });

  it("refuses a wrong value (422) and saves nothing; an unknown key is 404", async () => {
    const before = await app.db!.auditLog.count();
    const r = await call("owner", "PUT", `/workspace/app-settings/${KEY}`, { value: -5 });
    expect(r.statusCode).toBe(422);
    expect(await app.db!.auditLog.count()).toBe(before);
    expect((await call("owner", "PUT", `/workspace/app-settings/${KEY}`, { value: 10, extra: 1 })).statusCode).toBe(422);
    expect((await call("owner", "PUT", "/workspace/app-settings/expenses.nothing", { value: 1 })).statusCode).toBe(404);
    expect((await call("owner", "PUT", "/workspace/app-settings/expenses.categories", { value: ["x"] })).statusCode).toBe(404);   // platform scope: not a business's
  });

  it("someone without settings rights reads but can't change", async () => {
    const { canEdit, s } = await valueOf("agent");
    expect(canEdit).toBe(false);
    expect(s).toMatchObject({ value: 25000 });
    expect((await call("agent", "PUT", `/workspace/app-settings/${KEY}`, { value: 1 })).statusCode).toBe(403);
    expect((await valueOf("owner")).s).toMatchObject({ value: 25000 });
  });

  it("a read-only support session can't change", async () => {
    const ctx = {
      ...makeTestContext({ db: app.db!, businessId: ids.agency!, branches: [], userId: "support-1", isOwner: false }),
      impersonation: { staffId: "support-1", reason: "customer asked", expiresAt: new Date(Date.now() + 60_000), readOnly: true },
    };
    const s = new AppSettingsService(() => new SettingsService(app.db! as never, app.log));
    await expect(s.change(ctx as never, KEY, { value: 1 })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("money takes whole rupees, and null where the default is none", () => {
    const money = schemaOf({ key: "x", label: { en: "x" }, scope: "business", type: "money", default: null });
    expect(money.safeParse(null).success).toBe(true);
    expect(money.safeParse(12.5).success).toBe(false);
    expect(schemaOf({ key: "y", label: { en: "y" }, scope: "business", type: "bool", default: false }).safeParse(null).success).toBe(false);
  });
});
