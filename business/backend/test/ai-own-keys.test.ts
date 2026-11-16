// Business -> AI (P3-FE-6): the business's own AI accounts (the Integration Center at scope "business" for the four AI providers) and the
// business.ai setting; a Sheetal AI plan quoted in the cart like an app, but never shown as a marketplace card.
// Where it fits: runs with the business API tests (throwaway PostgreSQL): npm run test -w @sheetal/business-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { BILLING_SETTING, SHEETAL_AI_APP, seedCatalog } from "@sheetal/platform/billing/catalog";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const KEY = "sk-ant-test-secret-1234567890";
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"), { fetch: (async () => new Response("{}", { status: 401 })) as typeof fetch });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, invoices, payments, app_settings, integration_connections, notifications, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@aikeys.test`, userName: `ak-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Key Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Hotel", type: "hotel", planId: "hotel-business" }))).id;
  const role = (await db.role.findMany({ where: { tenantId: ids.biz } })).find((r) => !(r.perms as string[]).includes("*") && !(r.perms as string[]).some((x) => x.startsWith("workspace.settings")))!;
  await db.membership.create({ data: { tenantId: ids.biz, userId: ids.agent!, roleId: role.id, status: "active" } });
  await db.tenant.updateMany({ where: { id: { in: [ids.biz!, ids.otherBiz!] } }, data: { billingMode: "apps" } });
  await db.appSetting.create({ data: { key: BILLING_SETTING.key, value: { ...BILLING_SETTING.default, salesEnabled: true } } });
});
afterAll(async () => {
  await app.db!.$executeRawUnsafe(`TRUNCATE integration_connections, app_settings RESTART IDENTITY CASCADE`);
  await app.close();
});

describe("own AI accounts", () => {
  it("need workspace.settings.update; the four providers are listed with no key", async () => {
    expect((await call("agent", "GET", "/ai/connections")).statusCode).toBe(403);
    expect((await call("agent", "PUT", "/ai/connections/ai.anthropic", { values: { apiKey: KEY } })).statusCode).toBe(403);
    const r = await call("owner", "GET", "/ai/connections");
    expect(r.statusCode).toBe(200);
    expect(r.json().data.map((c: { connection: { integrationId: string; state: string } }) => [c.connection.integrationId, c.connection.state])).toEqual([["ai.anthropic", "none"], ["ai.openai", "none"], ["ai.gemini", "none"], ["voice.elevenlabs", "none"]]);
  });
  it("saving a key never returns it; another business doesn't see it; only the four ids", async () => {
    const s = await call("owner", "PUT", "/ai/connections/ai.anthropic", { values: { apiKey: KEY } });
    expect(s.statusCode).toBe(200);
    expect(s.body).not.toContain(KEY);
    const list = await call("owner", "GET", "/ai/connections");
    expect(list.body).not.toContain(KEY);
    expect(list.json().data[0].connection.state).not.toBe("none");
    expect((await call("other", "GET", "/ai/connections", undefined, ids.otherBiz)).json().data[0].connection.state).toBe("none");
    expect((await call("owner", "PUT", "/ai/connections/payments.esewa", { values: { a: "b" } })).statusCode).toBe(404);
    expect((await call("owner", "PUT", "/ai/connections/ai.anthropic", { values: { apiKey: KEY }, extra: 1 })).statusCode).toBe(422);
  });
  it("a key the provider refuses fails the test, without the key in the answer", async () => {
    const t = await call("owner", "POST", "/ai/connections/ai.anthropic/test");
    expect(t.body).not.toContain(KEY);
    expect(t.json().data?.ok ?? t.json().ok ?? false).toBe(false);
    expect((await call("owner", "POST", "/ai/connections/ai.anthropic/go-live")).statusCode).toBe(400); // nothing goes live on a failing key
    expect((await call("owner", "DELETE", "/ai/connections/ai.anthropic")).statusCode).toBe(200);
    expect((await call("owner", "GET", "/ai/connections")).json().data[0].connection.state).toBe("draft"); // keys deleted, nothing live
    expect(await app.db!.integrationSecretSet.count({ where: { connection: { tenantId: ids.biz } } })).toBe(0);
  });
});

describe("business.ai", () => {
  it("preferred provider and the fall back switch, per business; the credits answer shows it", async () => {
    expect((await call("agent", "PUT", "/ai/settings", { preferred: "ai.openai", fallbackToSheetal: true })).statusCode).toBe(403);
    expect((await call("owner", "PUT", "/ai/settings", { preferred: "ai.openai", fallbackToSheetal: true })).json().data).toEqual({ preferred: "ai.openai", fallbackToSheetal: true });
    expect((await call("owner", "PUT", "/ai/settings", { preferred: "voice.elevenlabs", fallbackToSheetal: true })).statusCode).toBe(422);
    expect((await call("owner", "GET", "/ai/credits")).json().data.settings).toEqual({ preferred: "ai.openai", fallbackToSheetal: true });
    expect((await call("other", "GET", "/ai/credits", undefined, ids.otherBiz)).json().data.settings).toEqual({ preferred: "auto", fallbackToSheetal: false });
  });
});

describe("a Sheetal AI plan in the cart", () => {
  it("quotes like an app at the catalog price, and never shows as a marketplace card or installs", async () => {
    const plan = seedCatalog().ai!.plans[0]!;
    const q = await call("owner", "POST", "/subscriptions/quote", { items: [{ kind: "subscribe", appId: SHEETAL_AI_APP, editionId: plan.key, periodMonths: 12 }] });
    expect(q.statusCode).toBe(200);
    const line = q.json().data.lines.find((l: { appId: string }) => l.appId === SHEETAL_AI_APP);
    expect([line.editionId, line.unitGrossPaisa]).toEqual([plan.key, plan.priceYearPaisa]);
    const m = (await call("owner", "GET", "/marketplace")).json().data;
    expect(m.catalog.apps.some((a: { id: string }) => a.id === SHEETAL_AI_APP)).toBe(false);
    expect((await call("owner", "POST", `/subscriptions/${SHEETAL_AI_APP}/install`)).statusCode).toBe(404);
  });
});
