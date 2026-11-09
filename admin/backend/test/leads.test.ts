import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
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
const call = (who: string, method: "GET" | "POST" | "PATCH", url: string, body?: object) => app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, notifications, outbound_emails, leads, lead_messages RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, role] of [["support", "support"], ["ops", "operations"], ["owner", null]] as const) {
    const u = await db.user.create({ data: { email: `${k}@sheetal.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  const t = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }));
  await db.tenant.update({ where: { id: t.id }, data: { status: "active", email: "office@everest.test" } });
  ids.biz = t.id;
  ids.lead = (await db.lead.create({ data: { kind: "requirement", name: "Sita Sharma", email: "sita@example.com", phone: "9801234567", message: "Flat in Lalitpur under 1 crore", public: true } })).id;
  ids.phoneOnly = (await db.lead.create({ data: { kind: "contact_agent", name: "Ram", phone: "9811111111", message: "Call me" } })).id;
  await db.lead.create({ data: { tenantId: t.id, kind: "contact_agent", name: "Business lead", message: "x" } });
});
afterAll(async () => { await app.close(); });

describe("platform leads", () => {
  it("lists only Sheetal's own leads, for staff", async () => {
    expect((await call("owner", "GET", "/admin/leads")).statusCode).toBe(403);
    const d = (await call("support", "GET", "/admin/leads")).json().data;
    expect(d.leads.map((l: { name: string }) => l.name).sort()).toEqual(["Ram", "Sita Sharma"]);
    expect(d.counts).toEqual({ new: 2 });
    expect(d.team.map((u: { name: string }) => u.name).sort()).toEqual(["ops", "support"]);
  });

  it("gives a lead to staff only, and tells them", async () => {
    expect((await call("support", "PATCH", `/admin/leads/${ids.lead}`, { assignee: ids.owner })).statusCode).toBe(400);
    expect((await call("support", "PATCH", `/admin/leads/${ids.lead}`, { assignee: ids.ops, follow: "2026-12-01", stage: "contacted" })).statusCode).toBe(200);
    expect(await app.db!.notification.count({ where: { userId: ids.ops, title: { startsWith: "Lead for you" } } })).toBe(1);
    expect((await call("ops", "GET", "/admin/leads?mine=1")).json().data.leads).toHaveLength(1);
    expect((await call("support", "PATCH", `/admin/leads/${ids.lead}`, { stage: "closed" })).statusCode).toBe(422);
  });

  it("keeps notes, emails a reply, and refuses email without an address", async () => {
    expect((await call("support", "POST", `/admin/leads/${ids.lead}/note`, { text: "Prefers ground floor" })).statusCode).toBe(200);
    expect((await call("support", "POST", `/admin/leads/${ids.lead}/reply`, { text: "We have three flats for you." })).statusCode).toBe(200);
    expect(await app.db!.outboundEmail.count({ where: { to: "sita@example.com" } })).toBe(1);
    expect((await call("support", "POST", `/admin/leads/${ids.phoneOnly}/reply`, { text: "Hi" })).statusCode).toBe(400);
  });

  it("passes a lead to a business: it moves to their Inbox, notes stay behind, they are told", async () => {
    const r = await call("support", "POST", `/admin/leads/${ids.lead}/pass`, { tenantId: ids.biz, note: "Serious buyer" });
    expect(r.statusCode).toBe(200);
    const l = await app.db!.lead.findUniqueOrThrow({ where: { id: ids.lead }, include: { messages: true } });
    expect(l).toMatchObject({ tenantId: ids.biz, status: "new", assigneeId: null, public: false });
    expect(l.branchId).toBeTruthy();
    expect(l.tags).toContain("From Sheetal");
    expect(l.messages.map((m) => m.direction)).toEqual(["out"]);
    expect(await app.db!.notification.count({ where: { userId: ids.owner, tenantId: ids.biz } })).toBe(1);
    expect(await app.db!.outboundEmail.count({ where: { to: "office@everest.test" } })).toBe(1);
    expect((await call("support", "GET", "/admin/leads")).json().data.leads).toHaveLength(1);
    expect((await call("support", "PATCH", `/admin/leads/${ids.lead}`, { stage: "won" })).statusCode).toBe(404);
  });
});
