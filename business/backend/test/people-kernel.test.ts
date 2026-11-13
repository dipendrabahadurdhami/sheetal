// Tests for People on the kernel (P2-W1 stage 2): what the move to apps/people/backend added. people.test.ts (the old tests) is NOT repeated here and passes unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// How it works: a real business API with an owner, a branch manager and an agent in "Everest Realty", and a second business; calls go through HTTP (app.inject),
// the database is read straight afterwards to check what was really written.
// Rules: covers isolation (other business), the kernel columns (version, createdBy), version conflict (409), the events written with each change, the old
// audit strings, and the leave approval rule: OFF = decided at once; ON = held for a second person, then run as the manager who asked.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.agency! } });
const addDays = (day: string, n: number) => ymd(new Date(dayOf(day).getTime() + n * 86_400_000));
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.agency, name } });
let sunday = addDays(nepalDay(), 8);
while (dayOf(sunday).getUTCDay() !== 0) sunday = addDays(sunday, 1);

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, audit_logs, event_outbox, approval_requests, approval_rules, attendance, leave_types, leave_requests RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "manager", "agent", "stranger"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-people.test`, userName: `k-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.other = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.stranger!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.manager!, roleId: (await role("branch_manager")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("People on the kernel", () => {
  it("writes the kernel columns and an event with each check-in and check-out, and keeps the old audit strings", async () => {
    const r = await call("agent", "POST", "/people/check-in", {});
    expect(r.statusCode).toBe(200);
    const row = await app.db!.attendance.findUniqueOrThrow({ where: { id: r.json().data.id } });
    expect(row).toMatchObject({ version: 1, createdBy: ids.agent, deletedAt: null });
    expect(await call("agent", "POST", "/people/check-out", {})).toMatchObject({ statusCode: 200 });
    expect((await app.db!.attendance.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(2);
    expect((await events("people.attendance.checked_in")).map((e) => (e.payload as { id: string }).id)).toContain(row.id);
    expect(await events("people.attendance.checked_out")).toHaveLength(1);
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.agency, action: "people.check_out", target: row.id } })).toBe(1);
  });

  it("refuses a fix made on an old version (409) and accepts the current one", async () => {
    const rec = (await app.db!.attendance.findFirstOrThrow({ where: { tenantId: ids.agency, userId: ids.agent } }));
    const stale = await call("owner", "PATCH", `/people/attendance/${rec.id}`, { inTime: "09:00", reason: "Came early", version: rec.version - 1 });
    expect(stale.statusCode).toBe(409);
    const ok = await call("owner", "PATCH", `/people/attendance/${rec.id}`, { inTime: "09:00", reason: "Came early", version: rec.version });
    expect(ok.statusCode).toBe(200);
    expect(await events("people.attendance.corrected")).toHaveLength(1);
  });

  it("never shows or changes another business's records", async () => {
    const rec = await app.db!.attendance.findFirstOrThrow({ where: { tenantId: ids.agency } });
    expect((await call("stranger", "PATCH", `/people/attendance/${rec.id}`, { inTime: "08:00", reason: "Not mine" }, ids.other)).statusCode).toBe(404);
    const board = (await call("stranger", "GET", "/people/board", undefined, ids.other)).json().data;
    expect(board.rows.map((p: { userId: string }) => p.userId)).toEqual([ids.stranger]);
  });

  it("decides leave at once while the approval rule is off", async () => {
    const type = (await call("agent", "GET", "/people/leave-types")).json().data.find((t: { name: string }) => t.name === "Casual");
    const id = (await call("agent", "POST", "/people/leave", { typeId: type.id, from: sunday, to: sunday })).json().data.id as string;
    expect((await events("people.leave.requested")).length).toBe(1);
    const r = await call("manager", "POST", `/people/leave/${id}/decide`, { status: "approved" });
    expect(r.statusCode).toBe(200);
    expect((await app.db!.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("approved");
    expect(await events("people.leave.decided")).toHaveLength(1);
  });

  it("with the rule on, holds an approval for a second person and then runs it as the manager who asked", async () => {
    await app.db!.approvalRule.create({ data: { tenantId: ids.agency!, action: "people.person.update", enabled: true, approverPermission: "people.person.update" } });
    const type = (await call("agent", "GET", "/people/leave-types")).json().data.find((t: { name: string }) => t.name === "Sick");
    const day = addDays(sunday, 7);
    const id = (await call("agent", "POST", "/people/leave", { typeId: type.id, from: day, to: day })).json().data.id as string;
    const held = await call("manager", "POST", `/people/leave/${id}/decide`, { status: "approved" });
    expect(held.statusCode).toBe(202);
    expect((await app.db!.leaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
    const approvalId = held.json().data.approvalId as string;
    expect((await call("manager", "POST", `/approvals/${approvalId}/approve`, {})).statusCode).toBeGreaterThanOrEqual(400);   // not the maker
    expect((await call("owner", "POST", `/approvals/${approvalId}/approve`, {})).statusCode).toBe(200);
    const done = await app.db!.leaveRequest.findUniqueOrThrow({ where: { id } });
    expect(done).toMatchObject({ status: "approved", decidedBy: ids.manager });
    // A rejection is never held.
    const id2 = (await call("agent", "POST", "/people/leave", { typeId: type.id, from: addDays(day, 7), to: addDays(day, 7) })).json().data.id as string;
    expect((await call("manager", "POST", `/people/leave/${id2}/decide`, { status: "rejected" })).statusCode).toBe(200);
    await app.db!.approvalRule.deleteMany({ where: { tenantId: ids.agency } });
  });
});
