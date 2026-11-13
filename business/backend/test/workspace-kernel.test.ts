// Tests for branches and business settings on the kernel (P2-W5/W6): what the move to apps/workspace/backend added. branches.test.ts, tenancy.test.ts and
// the settings tests (the old tests) are NOT repeated here and pass unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers the branch kernel columns and events, a stale branch change (409), a settings save with its audit line and event in one step, the secret
// mask, and isolation (another business can't change these branches).
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
const call = (who: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.biz, name } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-ws.test`, userName: `kw-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
});
afterAll(async () => { await app.close(); });

describe("Branches and settings on the kernel", () => {
  it("adds a branch with the kernel columns and an event, and refuses a stale change", async () => {
    const r = await call("owner", "POST", "/branches", { name: "Pokhara" });
    expect(r.json().message).toBe("Pokhara added.");
    const id = r.json().data.id as string;
    expect(await app.db!.branch.findUniqueOrThrow({ where: { id } })).toMatchObject({ createdBy: ids.owner, version: 1 });
    expect(await events("workspace.branch.added")).toHaveLength(1);
    expect((await call("owner", "PATCH", `/branches/${id}`, { phone: "061-123456", version: 1 })).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/branches/${id}`, { phone: "061-000000", version: 1 })).statusCode).toBe(409);
    expect((await call("other", "PATCH", `/branches/${id}`, { phone: "1" }, ids.otherBiz)).statusCode).toBe(404);
    expect((await call("owner", "DELETE", `/branches/${id}`)).json().message).toBe("Pokhara removed.");
    expect(await events("workspace.branch.removed")).toHaveLength(1);
  });

  it("saves a settings section with its audit line and event, and never sends a secret back", async () => {
    const r = await call("owner", "PUT", "/workspace/settings/payments", { own: { khalti: { key: "live_secret_key_123" } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.own.khalti.key).toBe("••••••••");
    expect(JSON.stringify((await call("owner", "GET", "/workspace/settings")).json().data)).not.toContain("live_secret_key_123");
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.biz, action: "settings.payments" } })).toBe(1);
    expect((await events("workspace.settings.saved")).map((e) => (e.payload as { section: string }).section)).toEqual(["payments"]);
  });
});
