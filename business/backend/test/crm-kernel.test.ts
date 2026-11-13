// Tests for the Inbox (CRM) on the kernel (P2-W5): what the move to apps/crm/backend added. The old lead tests are NOT repeated here and pass unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: pins WHO sees which lead: an agent (no "assign leads") sees the leads given to them AND the unassigned ones, never a colleague's; a branch manager
// (assigns leads) and the owner see all. Also the kernel columns, events, a stale change (409), and isolation from another business.
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
const call = (who: string, method: "GET" | "PATCH", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.agency! } });
const names = async (who: string) => ((await call(who, "GET", "/leads")).json().data as { name: string }[]).map((l) => l.name).sort();

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, leads, audit_logs, event_outbox RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "manager", "agent", "agent2", "stranger"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-crm.test`, userName: `kc-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.other = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.stranger!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.manager!, roleId: (await role("branch_manager")).id, status: "active" } });
  for (const a of ["agent", "agent2"]) await db.membership.create({ data: { tenantId: ids.agency!, userId: ids[a]!, roleId: (await role("agent")).id, status: "active" } });
  const lead = (name: string, assigneeId: string | null) => db.lead.create({ data: { tenantId: ids.agency!, kind: "contact_agent", name, email: `${name.toLowerCase()}@buyer.test`, message: "Still available?", assigneeId } });
  ids.mine = (await lead("Mine", ids.agent!)).id;
  ids.nobody = (await lead("Nobody", null)).id;
  ids.theirs = (await lead("Theirs", ids.agent2!)).id;
});
afterAll(async () => { await app.close(); });

describe("Inbox on the kernel", () => {
  it("shows an agent their own leads AND unassigned ones, never a colleague's", async () => {
    expect(await names("agent")).toEqual(["Mine", "Nobody"]);
    expect((await call("agent", "PATCH", `/leads/${ids.theirs}`, { stage: "contacted" })).statusCode).toBe(404);
  });

  it("shows a branch manager and the owner every lead", async () => {
    expect(await names("manager")).toEqual(["Mine", "Nobody", "Theirs"]);
    expect(await names("owner")).toEqual(["Mine", "Nobody", "Theirs"]);
  });

  it("lets an agent take an unassigned lead, with the kernel columns and an event, and refuses a stale change", async () => {
    const lead = ((await call("agent", "GET", "/leads")).json().data as { id: string; version: number }[]).find((l) => l.id === ids.nobody)!;
    expect(lead.version).toBe(1);
    expect((await call("agent", "PATCH", `/leads/${ids.nobody}`, { assignee: ids.agent, version: 1 })).statusCode).toBe(200);
    expect(await app.db!.lead.findUniqueOrThrow({ where: { id: ids.nobody! } })).toMatchObject({ assigneeId: ids.agent, version: 2, updatedBy: ids.agent });
    expect((await call("agent", "PATCH", `/leads/${ids.nobody}`, { stage: "viewing", version: 1 })).statusCode).toBe(409);
    expect((await call("agent", "PATCH", `/leads/${ids.mine}`, { stage: "viewing" })).statusCode).toBe(200);
    expect(await app.db!.eventOutbox.count({ where: { tenantId: ids.agency, name: "crm.lead.stage_changed" } })).toBe(1);
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.agency, action: "lead.stage" } })).toBe(1);
  });

  it("never shows or changes another business's leads", async () => {
    expect((await call("stranger", "GET", "/leads", undefined, ids.other)).json().data).toEqual([]);
    expect((await call("stranger", "PATCH", `/leads/${ids.mine}`, { stage: "lost" }, ids.other)).statusCode).toBe(404);
  });
});
