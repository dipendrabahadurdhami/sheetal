import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";
import { runBillingCycle } from "@sheetal/backend-core/domain/billing";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PATCH", url: string, body?: object) => app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, invoices, support_tickets, support_messages RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, role] of [["support", "support"], ["ops", "operations"], ["finance", "finance"], ["owner", null]] as const) {
    const u = await db.user.create({ data: { email: `${k}@sheetal.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.t = (await db.supportTicket.create({ data: { tenantId: ids.biz!, userId: ids.owner!, subject: "Invoice question", messages: { create: { from: "business", userId: ids.owner, body: "Why two invoices?" } } } })).id;
});
afterAll(async () => { await app.close(); });

describe("support inbox", () => {
  it("is for staff who see businesses", async () => {
    expect((await call("owner", "GET", "/admin/support")).statusCode).toBe(403);
    const d = (await call("support", "GET", "/admin/support?status=open")).json().data;
    expect(d.tickets).toHaveLength(1);
    expect(d.tickets[0]).toMatchObject({ no: "SUP-0001", tenant: "Lakeside Hotel", unread: true });
    expect(d.team.map((u: { name: string }) => u.name).sort()).toEqual(["finance", "ops", "support"]);
  });

  it("replies by bell and email, keeps notes inside, and assigns to staff only", async () => {
    expect((await call("support", "POST", `/admin/support/${ids.t}/note`, { body: "Duplicate renewal" })).statusCode).toBe(200);
    expect((await call("support", "POST", `/admin/support/${ids.t}/reply`, { body: "One was a renewal; we voided it." })).statusCode).toBe(200);
    const t = await app.db!.supportTicket.findUniqueOrThrow({ where: { id: ids.t } });
    expect(t).toMatchObject({ status: "waiting", assigneeId: ids.support });
    expect(await app.db!.notification.count({ where: { userId: ids.owner, tenantId: ids.biz } })).toBe(1);
    expect(await app.db!.outboundEmail.count({ where: { to: "owner@sheetal.test" } })).toBe(1);
    expect((await call("support", "PATCH", `/admin/support/${ids.t}`, { assignee: ids.owner })).statusCode).toBe(400);
    expect((await call("support", "PATCH", `/admin/support/${ids.t}`, { assignee: ids.ops, status: "closed" })).statusCode).toBe(200);
    expect(await app.db!.notification.count({ where: { userId: ids.ops, title: { startsWith: "Support message for you" } } })).toBe(1);
  });
});

describe("audit log", () => {
  it("filters and exports", async () => {
    const all = (await call("ops", "GET", "/admin/audit")).json();
    expect(all.meta.total).toBeGreaterThanOrEqual(2);
    expect(all.kinds).toContain("support");
    expect((await call("ops", "GET", "/admin/audit?kind=support")).json().data.every((r: { action: string }) => r.action.startsWith("support."))).toBe(true);
    expect((await call("ops", "GET", `/admin/audit?actorId=${ids.support}`)).json().data.every((r: { actorId: string }) => r.actorId === ids.support)).toBe(true);
    expect((await call("ops", "GET", "/admin/audit?from=2026-02-30")).statusCode).toBe(400);
    expect((await call("ops", "GET", "/admin/audit?kind=DROP TABLE")).statusCode).toBe(422);
    const csv = await call("ops", "GET", "/admin/audit.csv?kind=support");
    expect(csv.statusCode).toBe(200);
    expect(csv.body.replace(/^\uFEFF/, "").split("\r\n")[0]).toBe("When (Nepal),Who,Email,Action,Target,Business,IP");
    expect((await call("finance", "GET", "/admin/audit")).statusCode).toBe(403);
  });
});

describe("free trials", () => {
  it("start on the Business plan and move to Starter when they end unpaid", async () => {
    const db = app.db!;
    const t = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Trial Agency", type: "agency", trialDays: 14 }));
    expect(t).toMatchObject({ planId: "agency-business", status: "trial" });
    const site = { siteUrl: "https://sheetal.test" };
    expect(await runBillingCycle(db, app.mailer, { ...site, now: new Date(t.renewsAt!.getTime() - 3 * 864e5) })).toMatchObject({ reminded: 1 });
    expect(await runBillingCycle(db, app.mailer, { ...site, now: new Date(t.renewsAt!.getTime() + 1000) })).toMatchObject({ trialsEnded: 1, pastDue: 0 });
    expect(await db.tenant.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ planId: "agency-starter", status: "active", renewsAt: null });
    expect(await db.invoice.count({ where: { tenantId: t.id, status: "open" } })).toBe(0);
  });
});
