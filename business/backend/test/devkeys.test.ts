import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { sha256 } from "@sheetal/backend-core/lib/secrets";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "DELETE", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, api_keys RESTART IDENTITY CASCADE`);
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
afterAll(async () => { await app.close(); });

describe("developer keys", () => {
  it("shows the key once and keeps only its hash", async () => {
    const r = await call("owner", "POST", "/developers/keys", { name: "Website", scopes: ["listings.read", "leads.write"] });
    expect(r.statusCode).toBe(200);
    const { id, key } = r.json().data;
    expect(key).toMatch(/^sk_live_[A-Za-z0-9_-]+$/);
    const row = await app.db!.apiKey.findUniqueOrThrow({ where: { id } });
    expect(row.hash).toBe(sha256(key));
    expect(row.scopes).toEqual(["listings.read", "leads.write"]);
    const list = await call("owner", "GET", "/developers/keys");
    expect(JSON.stringify(list.json())).not.toContain(key);
    expect(list.json().data[0]).toMatchObject({ name: "Website", revoked: false, lastUsedAt: null });
    expect(JSON.stringify(await app.db!.auditLog.findMany())).not.toContain(key);
    ids.key = id;
  });

  it("checks the name and scopes, and who may make keys", async () => {
    expect((await call("owner", "POST", "/developers/keys", { name: "x", scopes: ["listings.read"] })).statusCode).toBe(422);
    expect((await call("owner", "POST", "/developers/keys", { name: "Empty", scopes: [] })).statusCode).toBe(422);
    expect((await call("owner", "POST", "/developers/keys", { name: "Odd", scopes: ["everything"] })).statusCode).toBe(422);
    expect((await call("agent", "POST", "/developers/keys", { name: "Mine", scopes: ["listings.read"] })).statusCode).toBe(403);
    expect((await call("agent", "GET", "/developers/keys")).statusCode).toBe(403);
  });

  it("revokes a key and audits making and revoking", async () => {
    expect((await call("agent", "DELETE", `/developers/keys/${ids.key}`)).statusCode).toBe(403);
    expect((await call("owner", "DELETE", `/developers/keys/${ids.key}`)).statusCode).toBe(200);
    expect((await app.db!.apiKey.findUniqueOrThrow({ where: { id: ids.key } })).revokedAt).not.toBeNull();
    expect((await call("owner", "DELETE", "/developers/keys/nope")).statusCode).toBe(404);
    const actions = (await app.db!.auditLog.findMany({ where: { tenantId: ids.agency } })).map((a) => a.action);
    expect(actions.filter((a) => a.startsWith("developers.")).length).toBeGreaterThanOrEqual(2);
  });
});
