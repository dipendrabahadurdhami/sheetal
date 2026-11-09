import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });
const addDays = (day: string, n: number) => ymd(new Date(dayOf(day).getTime() + n * 86_400_000));
const today = nepalDay();
const isSaturday = dayOf(today).getUTCDay() === 6;
// The next Sunday after today (leave can't include Saturday, the weekly off day).
let sunday = addDays(today, 1);
while (dayOf(sunday).getUTCDay() !== 0) sunday = addDays(sunday, 1);

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, audit_logs, attendance, leave_types, leave_requests RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "manager", "agent", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@everest.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.manager!, roleId: (await role("branch_manager")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("check in and out", () => {
  it("checks in once at a time, and marks the first check-in late after the start time", async () => {
    await call("owner", "PUT", "/people/settings", { workStart: "00:00" });
    const a = await call("agent", "POST", "/people/check-in", { lat: 27.7, lng: 85.3 });
    expect(a.statusCode).toBe(200);
    expect(a.json().data.late).toBe(true);
    expect((await call("agent", "POST", "/people/check-in", {})).statusCode).toBe(409);
    expect((await call("agent", "POST", "/people/check-out", {})).statusCode).toBe(200);
    expect((await call("agent", "POST", "/people/check-out", {})).statusCode).toBe(409);
    await call("owner", "PUT", "/people/settings", { workStart: "23:59" });
    const again = await call("agent", "POST", "/people/check-in", {});
    expect(again.json().data.late).toBe(false);
    await call("agent", "POST", "/people/check-out", {});
    const me = (await call("agent", "GET", "/people/me")).json().data;
    expect(me.open).toBeNull();
    expect(me.records).toHaveLength(2);
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.agency, action: "people.check_in" } })).toBe(2);
  });

  it("only managers change the start time", async () => {
    expect((await call("agent", "PUT", "/people/settings", { workStart: "09:00" })).statusCode).toBe(403);
    expect((await call("manager", "PUT", "/people/settings", { workStart: "09:00" })).statusCode).toBe(200);
    expect((await call("agent", "GET", "/people/settings")).json().data.workStart).toBe("09:00");
    expect((await call("manager", "PUT", "/people/settings", { workStart: "9am" })).statusCode).toBe(422);
  });
});

describe("the board and fixing records", () => {
  it("shows managers who is in, and keeps it from people without the permission", async () => {
    expect((await call("agent", "GET", "/people/board")).statusCode).toBe(403);
    const d = (await call("manager", "GET", "/people/board")).json().data;
    const agent = d.rows.find((r: { name: string }) => r.name === "agent");
    expect(agent.status).toBe("late");
    expect(agent.records).toHaveLength(2);
    const other = d.rows.find((r: { name: string }) => r.name === "manager");
    expect(other.status).toBe(isSaturday ? "off" : "absent");
    expect(d.counts.late).toBe(1);
  });

  it("fixes a record only with a reason, and audits what changed", async () => {
    const rec = (await call("manager", "GET", "/people/board")).json().data.rows.find((r: { name: string }) => r.name === "agent").records[0];
    expect((await call("agent", "PATCH", `/people/attendance/${rec.id}`, { inTime: "09:00", reason: "my fix" })).statusCode).toBe(403);
    expect((await call("manager", "PATCH", `/people/attendance/${rec.id}`, { inTime: "00:05" })).statusCode).toBe(422);
    expect((await call("manager", "PATCH", `/people/attendance/${rec.id}`, { inTime: "08:55", outTime: "08:50", reason: "Typo" })).statusCode).toBe(400);
    const ok = await call("manager", "PATCH", `/people/attendance/${rec.id}`, { inTime: "08:55", outTime: "17:30", reason: "Forgot to check in on time" });
    expect(ok.statusCode).toBe(200);
    const row = await app.db!.attendance.findUniqueOrThrow({ where: { id: rec.id } });
    expect(row).toMatchObject({ source: "manual", editedBy: ids.manager });
    const log = await app.db!.auditLog.findFirstOrThrow({ where: { tenantId: ids.agency, action: "people.attendance_fix" } });
    expect(JSON.stringify(log.meta)).toContain("Forgot to check in on time");
  });

  it("adds a missed day, and the monthly summary counts it", async () => {
    const day = addDays(today, -1);
    const add = await call("manager", "POST", "/people/attendance", { userId: ids.agent, day, inTime: "09:30", outTime: "17:00", reason: "Machine was down" });
    expect(add.statusCode).toBe(200);
    expect((await call("manager", "POST", "/people/attendance", { userId: ids.agent, day: addDays(today, 3), inTime: "09:30", reason: "Future" })).statusCode).toBe(400);
    const s = (await call("manager", "GET", `/people/summary?month=${today.slice(0, 7)}`)).json().data;
    const agent = s.rows.find((r: { name: string }) => r.name === "agent");
    expect(agent.daysPresent).toBe(day.slice(0, 7) === today.slice(0, 7) ? 2 : 1);
    expect((await call("agent", "GET", `/people/summary?month=${today.slice(0, 7)}`)).statusCode).toBe(403);
  });
});

describe("leave", () => {
  it("starts with the usual leave types; managers change them", async () => {
    const types = (await call("agent", "GET", "/people/leave-types")).json().data;
    expect(types.map((t: { name: string }) => t.name)).toEqual(["Casual", "Sick", "Home", "Festival", "Unpaid"]);
    ids.casual = types[0].id;
    expect((await call("agent", "POST", "/people/leave-types", { name: "Study", daysPerYear: 3, paid: true })).statusCode).toBe(403);
    expect((await call("manager", "POST", "/people/leave-types", { name: "Study", daysPerYear: 3, paid: true })).statusCode).toBe(200);
    expect((await call("manager", "POST", "/people/leave-types", { name: "Study", daysPerYear: 3, paid: true })).statusCode).toBe(409);
  });

  it("counts days without Saturday, keeps to the yearly days and refuses overlaps", async () => {
    const sat = addDays(sunday, -1);
    expect((await call("agent", "POST", "/people/leave", { typeId: ids.casual, from: sat, to: sunday })).statusCode).toBe(200);
    expect((await call("agent", "GET", "/people/me")).json().data.leaves[0].days).toBe(1);
    expect((await call("agent", "POST", "/people/leave", { typeId: ids.casual, from: sunday, to: sunday })).statusCode).toBe(409);
    expect((await call("agent", "POST", "/people/leave", { typeId: ids.casual, from: addDays(sunday, 7), to: addDays(sunday, 16) })).statusCode).toBe(400);
    expect((await call("agent", "POST", "/people/leave", { typeId: ids.casual, from: sat, to: sat })).statusCode).toBe(400);
    expect((await call("agent", "POST", "/people/leave", { typeId: ids.casual, from: addDays(today, -2), to: today })).statusCode).toBe(400);
    ids.req = (await call("agent", "GET", "/people/me")).json().data.leaves[0].id;
  });

  it("tells managers about a request, and the person about the decision", async () => {
    expect(await app.db!.notification.count({ where: { userId: ids.manager, type: "people" } })).toBe(1);
    expect((await call("agent", "POST", `/people/leave/${ids.req}/decide`, { status: "approved" })).statusCode).toBe(403);
    expect((await call("manager", "POST", `/people/leave/${ids.req}/decide`, { status: "approved", note: "Enjoy" })).statusCode).toBe(200);
    expect((await call("manager", "POST", `/people/leave/${ids.req}/decide`, { status: "rejected" })).statusCode).toBe(409);
    expect(await app.db!.notification.count({ where: { userId: ids.agent, type: "people" } })).toBe(1);
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.agency, action: "people.leave_approve" } })).toBe(1);
  });

  it("shows approved leave on the board, and managers can't decide their own", async () => {
    const d = (await call("manager", "GET", `/people/board?day=${sunday}`)).json().data;
    expect(d.rows.find((r: { name: string }) => r.name === "agent")).toMatchObject({ status: "leave", leave: "Casual" });
    expect((await call("manager", "POST", "/people/leave", { typeId: ids.casual, from: addDays(sunday, 7), to: addDays(sunday, 7) })).statusCode).toBe(200);
    const id = (await call("manager", "GET", "/people/me")).json().data.leaves[0].id;
    expect((await call("manager", "POST", `/people/leave/${id}/decide`, { status: "approved" })).statusCode).toBe(403);
    expect((await call("owner", "POST", `/people/leave/${id}/decide`, { status: "approved" })).statusCode).toBe(200);
    expect((await call("agent", "GET", "/people/leave")).json().data).toEqual([]);
  });

  it("lets a person cancel their own leave", async () => {
    expect((await call("agent", "POST", "/people/leave", { typeId: ids.casual, from: addDays(sunday, 14), to: addDays(sunday, 14), halfDay: true })).statusCode).toBe(200);
    const id = (await call("agent", "GET", "/people/me")).json().data.leaves.find((l: { halfDay: boolean }) => l.halfDay).id;
    expect((await call("manager", "POST", `/people/leave/${id}/cancel`)).statusCode).toBe(404);
    expect((await call("agent", "POST", `/people/leave/${id}/cancel`)).statusCode).toBe(200);
    expect(ymd((await app.db!.leaveRequest.findUniqueOrThrow({ where: { id } })).fromDay)).toBe(addDays(sunday, 14));
  });

  it("keeps outsiders out", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/people/me", headers: { authorization: `Bearer ${tok.other}`, "x-tenant-id": ids.agency! } });
    expect(r.statusCode).toBe(403);
  });
});
