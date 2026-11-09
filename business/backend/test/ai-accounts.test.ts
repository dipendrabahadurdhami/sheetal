import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

const OWN = "sk-ant-api03-OWNKEY1234567890abcdefTEST";
let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
let pinged = 0;
const fakeAi = { model: "claude-opus-5-5", credits: {}, client: { messages: { create: async () => { pinged++; return {}; } }, beta: { messages: { create: async () => ({}) } } } } as never;
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.hotel! } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"), { ai: fakeAi });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, ai_usage RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "staff"]) {
    const u = await db.user.create({ data: { email: `${k}@lakeside.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Inn", type: "hotel", planId: "hotel-business" }))).id;
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ids.hotel, key: "frontdesk" } });
  await db.membership.create({ data: { tenantId: ids.hotel!, userId: ids.staff!, roleId: role.id, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("a business's own AI key", () => {
  it("is write-only: only hasKey and the last 4 come back, and it is stored sealed", async () => {
    expect((await call("staff", "PUT", "/ai-account", { apiKey: OWN })).statusCode).toBe(403);
    expect((await call("owner", "PUT", "/ai-account", { apiKey: "not-a-key" })).statusCode).toBe(422);
    const r = await call("owner", "PUT", "/ai-account", { apiKey: OWN, model: "claude-sonnet-5-5", cap: 50 });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ hasKey: true, last4: "TEST", model: "claude-sonnet-5-5", cap: 50 });
    const get = await call("owner", "GET", "/ai-account");
    for (const body of [r.body, get.body]) { expect(body).not.toContain(OWN); expect(body).not.toContain("OWNKEY"); }
    const stored = JSON.stringify(await app.db!.appSetting.findMany());
    expect(stored).not.toContain("OWNKEY");
    expect(JSON.stringify(await app.db!.auditLog.findMany())).not.toContain("OWNKEY");
    expect((await call("owner", "PUT", "/ai-account", { model: "gpt-9" })).statusCode).toBe(422);
    expect((await call("owner", "PUT", "/ai-account", { cap: 80 })).json().data).toMatchObject({ hasKey: true, last4: "TEST", cap: 80 });
  });

  it("tests the key, and removes it", async () => {
    expect((await call("owner", "POST", "/ai-account/test")).statusCode).toBe(200);
    expect(pinged).toBe(1);
    const gone = await call("owner", "DELETE", "/ai-account");
    expect(gone.json().data).toMatchObject({ hasKey: false, last4: null });
    expect((await call("owner", "POST", "/ai-account/test")).statusCode).toBe(400);
  });

  it("can be switched off by Sheetal", async () => {
    await app.db!.appSetting.create({ data: { key: "integration.ai", value: { allowOwnKeys: false } } });
    expect((await call("owner", "PUT", "/ai-account", { apiKey: OWN })).statusCode).toBe(403);
  });
});
