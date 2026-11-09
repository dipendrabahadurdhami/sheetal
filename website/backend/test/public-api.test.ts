import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { newToken, sha256 } from "@sheetal/backend-core/lib/secrets";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const ids: Record<string, string> = {};
const keys: Record<string, string> = {};
const get = (key: string | null, url: string) => app.inject({ method: "GET", url: `/v1/public${url}`, headers: key ? { authorization: `Bearer ${key}` } : {} });
const post = (key: string, url: string, body: object) => app.inject({ method: "POST", url: `/v1/public${url}`, payload: body, headers: { authorization: `Bearer ${key}` } });
const mint = async (tenantId: string, scopes: string[], revoked = false) => {
  const key = `sk_live_${newToken(24)}`;
  await app.db!.apiKey.create({ data: { tenantId, name: scopes.join("+"), prefix: key.slice(8, 16), hash: sha256(key), scopes, createdBy: ids.owner!, revokedAt: revoked ? new Date() : null } });
  return key;
};

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "website"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, api_keys RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const u = await db.user.create({ data: { email: "owner@everest.test", userName: "owner", emailVerifiedAt: new Date() } });
  ids.owner = u.id;
  ids.a = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: u.id, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  keys.read = await mint(ids.a!, ["listings.read"]);
  keys.write = await mint(ids.a!, ["leads.write"]);
  keys.revoked = await mint(ids.a!, ["listings.read"], true);
});
afterAll(async () => { await app.close(); });

describe("public API", () => {
  it("answers only to a valid key", async () => {
    expect((await get(null, "/listings")).statusCode).toBe(401);
    expect((await get("sk_live_nottherightkeynottherightkey", "/listings")).statusCode).toBe(401);
    expect((await get(keys.revoked!, "/listings")).statusCode).toBe(401);
  });

  it("lists published listings and notes the key was used", async () => {
    const r = await get(keys.read!, "/listings?per=1");
    expect(r.statusCode).toBe(200);
    expect((await app.db!.apiKey.findUniqueOrThrow({ where: { hash: sha256(keys.read!) } })).lastUsedAt).not.toBeNull();
  });

  it("enforces scopes on every route", async () => {
    expect((await get(keys.write!, "/listings")).statusCode).toBe(403);
    expect((await get(keys.read!, "/bookings")).statusCode).toBe(403);
    expect((await post(keys.read!, "/leads", { name: "Hari", phone: "9841000000", message: "Hello" })).statusCode).toBe(403);
  });

  it("puts an enquiry in the Inbox as an api lead", async () => {
    const ok = await post(keys.write!, "/leads", { name: "Hari", phone: "9841000000", message: "Interested" });
    expect(ok.statusCode).toBe(200);
    expect(await app.db!.lead.count({ where: { tenantId: ids.a, kind: "api" } })).toBe(1);
  });
});
