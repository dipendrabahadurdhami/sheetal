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
const call = (who: string, method: "GET" | "POST", url: string, body?: object) => app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.biz! } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, audit_logs, support_tickets, support_messages RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, role] of [["owner", null], ["agent", null], ["staff", "support"]] as const) {
    const u = await db.user.create({ data: { email: `${k}@support.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  await db.membership.create({ data: { tenantId: ids.biz!, userId: ids.agent!, roleId: (await db.role.findFirstOrThrow({ where: { tenantId: ids.biz, key: "agent" } })).id, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("messages to Sheetal", () => {
  it("opens a ticket and tells Sheetal's staff", async () => {
    expect((await call("agent", "POST", "/support", { subject: "x", body: "help" })).statusCode).toBe(422);
    const r = await call("agent", "POST", "/support", { subject: "eSewa payment missing", body: "I paid Rs. 1,500 but the invoice is open." });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.no).toBe("SUP-0001");
    ids.t = r.json().data.id;
    expect(await app.db!.notification.count({ where: { userId: ids.staff, title: { startsWith: "New message from Everest Realty" } } })).toBe(1);
  });

  it("shows the owner every ticket and others only their own; notes never leave Sheetal", async () => {
    await call("owner", "POST", "/support", { subject: "Owner question", body: "How do add-ons renew?" });
    expect((await call("agent", "GET", "/support")).json().data).toHaveLength(1);
    expect((await call("owner", "GET", "/support")).json().data).toHaveLength(2);
    await app.db!.supportMessage.create({ data: { ticketId: ids.t!, from: "note", body: "Check eSewa ref" } });
    await app.db!.supportMessage.create({ data: { ticketId: ids.t!, from: "staff", userId: ids.staff, body: "Found it, confirmed." } });
    await app.db!.supportTicket.update({ where: { id: ids.t }, data: { status: "waiting", lastAt: new Date() } });
    expect((await call("agent", "GET", "/support")).json().data[0]).toMatchObject({ status: "waiting", unread: true });
    const one = (await call("agent", "GET", `/support/${ids.t}`)).json().data;
    expect(one.messages.map((m: { from: string }) => m.from)).toEqual(["business", "staff"]);
    expect((await call("agent", "GET", "/support")).json().data[0].unread).toBe(false);
  });

  it("replies, closes, and reopens on a new reply", async () => {
    expect((await call("agent", "POST", `/support/${ids.t}/close`)).statusCode).toBe(200);
    expect((await call("agent", "POST", `/support/${ids.t}/close`)).statusCode).toBe(400);
    expect((await call("agent", "POST", `/support/${ids.t}/reply`, { body: "One more thing" })).statusCode).toBe(200);
    expect((await app.db!.supportTicket.findUniqueOrThrow({ where: { id: ids.t } })).status).toBe("open");
    const other = (await app.db!.supportTicket.findFirstOrThrow({ where: { userId: ids.owner } })).id;
    expect((await call("agent", "GET", `/support/${other}`)).statusCode).toBe(404);
  });
});
