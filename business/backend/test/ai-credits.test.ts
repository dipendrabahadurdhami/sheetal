// Sheetal AI credits through the business API (P3-BE-8): GET /ai/credits (billing people only, this business's credits only) and the AI
// state in GET /entitlements for a business on billingMode "apps": locked without credits, Sheetal AI once credits and Sheetal's own AI
// connection are there, own key once the business's own AI connection is live.
// Where it fits: runs with the business API tests (throwaway PostgreSQL): npm run test -w @sheetal/business-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { addGrant } from "@sheetal/platform/billing/ai-credits";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, url: string, tenant?: string) => app.inject({ method: "GET", url: `/v1${url}`, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, integration_connections RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@aicredits.test`, userName: `aic-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "AI Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Hotel", type: "hotel", planId: "hotel-business" }))).id;
  const role = (await db.role.findMany({ where: { tenantId: ids.biz } })).find((r) => !(r.perms as string[]).includes("*") && !(r.perms as string[]).some((x) => x.startsWith("workspace.billing")))!;
  await db.membership.create({ data: { tenantId: ids.biz, userId: ids.agent!, roleId: role.id, status: "active" } });
  await db.tenant.update({ where: { id: ids.biz }, data: { billingMode: "apps" } });
});
afterAll(async () => { await app.close(); });

describe("AI credits and state", () => {
  it("locked first; Sheetal AI with credits and Sheetal's connection; own key once the business's own connection is live", async () => {
    const db = app.db!;
    expect((await call("owner", "/entitlements")).json().data.ai).toBe("locked");
    await addGrant(db, { tenantId: ids.biz!, credits: 100, source: "trial", expiresAt: new Date(Date.now() + 14 * 864e5) });
    expect((await call("owner", "/entitlements")).json().data.ai).toBe("locked"); // credits, but Sheetal AI isn't connected yet
    await db.integrationConnection.create({ data: { integrationId: "ai.anthropic", scope: "platform", tenantId: null, ownerKey: "platform", state: "live", mode: "live", config: {} } });
    expect((await call("owner", "/entitlements")).json().data.ai).toBe("sheetal");
    await db.integrationConnection.create({ data: { integrationId: "ai.openai", scope: "business", tenantId: ids.biz!, ownerKey: ids.biz!, state: "live", mode: "live", config: {} } });
    expect((await call("owner", "/entitlements")).json().data.ai).toBe("own_key");
  });

  it("GET /ai/credits: the balance and grants of this business only, for billing people", async () => {
    const r = await call("owner", "/ai/credits");
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ balance: 100, settings: { preferred: "auto", fallbackToSheetal: false }, grants: [expect.objectContaining({ source: "trial", remaining: 100 })] });
    expect((await call("agent", "/ai/credits")).statusCode).toBe(403);
    expect((await call("other", "/ai/credits", ids.otherBiz)).json().data).toMatchObject({ balance: 0, grants: [], state: "locked" });
  });
});
