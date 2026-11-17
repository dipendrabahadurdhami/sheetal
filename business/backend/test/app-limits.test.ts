// The free limits of the apps are enforced on app subscriptions (17 Nov 2026; platform/src/billing/room.ts). Until then the catalog's limits
// were shown and sold but checked nowhere, so a free business was never stopped.
// What it proves through the business API: a hotel on the free Hotel edition adds 5 rooms and is refused the 6th with the one
// 402 "limit_reached" answer (nothing written), and the answer names the edition to upgrade to; after it buys the full edition the same
// request goes through; a free Expenses edition refuses a recurring expense (limit 0) and the 51st expense of the month; and a business
// still on its Business plan (every business before the cutover) is not checked by any of this: its plan decides, exactly as before.
// Where it fits: runs with the business API tests (throwaway PostgreSQL): npm run test -w @sheetal/business-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { monthStart } from "@sheetal/platform/billing/room";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": who === "owner" ? ids.biz! : ids.planBiz! } });
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
const rooms = (nos: string[], branchId: string) => ({ type: "Deluxe", rate: 6000, nos, branchId });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, expenses RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "planner"]) {
    const u = await db.user.create({ data: { email: `${k}@app-limits.test`, userName: `lim-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  // "biz" is on app subscriptions with the free Hotel and Expenses editions; "planBiz" stays on its Business plan.
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Limit Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.planBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.planner!, name: "Plan Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.biz, name: "Head office" } })).id;
  ids.planHead = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.planBiz, name: "Head office" } })).id;
  await db.tenant.update({ where: { id: ids.biz }, data: { billingMode: "apps" } });
  await db.subscription.create({ data: { tenantId: ids.biz!, appId: "hotel", editionId: "free", status: "active" } });
  await db.subscription.create({ data: { tenantId: ids.biz!, appId: "expenses", editionId: "free", status: "active" } });
});
// The suite's database is shared by every file: what this file adds beyond the usual tables is removed again.
afterAll(async () => {
  const mine = [ids.biz!, ids.planBiz!];
  await app.db!.expense.deleteMany({ where: { tenantId: { in: mine } } });
  await app.db!.room.deleteMany({ where: { tenantId: { in: mine } } });
  await app.db!.subscription.deleteMany({ where: { tenantId: { in: mine } } });
  await app.close();
});

describe("Hotel: rooms", () => {
  it("the free edition takes 5 rooms and refuses the 6th with limit_reached; nothing is written", async () => {
    expect((await call("owner", "POST", "/rooms", rooms(["101", "102", "103", "104"], ids.head!))).statusCode).toBe(200);
    // Two more would make 6: refused as a whole.
    const two = await call("owner", "POST", "/rooms", rooms(["105", "106"], ids.head!));
    expect(two.statusCode).toBe(402);
    expect(two.json()).toMatchObject({ code: "limit_reached" });
    expect(await app.db!.room.count({ where: { tenantId: ids.biz } })).toBe(4);
    expect((await call("owner", "POST", "/rooms", rooms(["105"], ids.head!))).statusCode).toBe(200);
    const sixth = await call("owner", "POST", "/rooms", rooms(["106"], ids.head!));
    expect(sixth.statusCode).toBe(402);
    expect(JSON.stringify(sixth.json())).toMatch(/"appId":"hotel"/);
    expect(JSON.stringify(sixth.json())).toMatch(/"tryEdition":"full"/);
    expect(await app.db!.room.count({ where: { tenantId: ids.biz } })).toBe(5);
  });

  it("after buying the full edition (40 rooms) the same request goes through", async () => {
    await app.db!.subscription.updateMany({ where: { tenantId: ids.biz, appId: "hotel" }, data: { editionId: "full", periodMonths: 1, currentPeriodStart: day(-1), currentPeriodEnd: day(29), priceGrossPaisa: 70_000n, source: "purchase" } });
    expect((await call("owner", "POST", "/rooms", rooms(["106"], ids.head!))).statusCode).toBe(200);
    expect(await app.db!.room.count({ where: { tenantId: ids.biz } })).toBe(6);
  });

  it("a business still on its plan is not checked by the editions: the plan decides, as before", async () => {
    // hotel-business allows far more than 5 rooms; six go through.
    const r = await call("planner", "POST", "/rooms", rooms(["1", "2", "3", "4", "5", "6"], ids.planHead!));
    expect(r.statusCode).toBe(200);
    expect(await app.db!.room.count({ where: { tenantId: ids.planBiz } })).toBe(6);
  });
});

describe("Expenses: a month's expenses and recurring expenses", () => {
  const body = () => ({ date: new Date().toISOString().slice(0, 10), category: "supplies", amount: 100, method: "cash", branchId: ids.head });

  it("recurring expenses belong to the full edition: the free edition (limit 0) refuses the first one", async () => {
    const r = await call("owner", "POST", "/expenses/recurring", { category: "rent", amount: 40_000, dayOfMonth: 1, method: "bank", branchId: ids.head });
    expect(r.statusCode).toBe(402);
    expect(r.json()).toMatchObject({ code: "limit_reached" });
    expect(await app.db!.recurringExpense.count({ where: { tenantId: ids.biz } })).toBe(0);
  });

  it("the free edition takes 50 expenses in the month and refuses the 51st; last month's do not count", async () => {
    const db = app.db!;
    expect((await call("owner", "POST", "/expenses", body())).statusCode).toBe(200);
    const one = await db.expense.findFirstOrThrow({ where: { tenantId: ids.biz } });
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = one;
    void _id; void _c; void _u;
    // 49 more this month (50 in all), and 30 from before this month began.
    await db.expense.createMany({ data: Array.from({ length: 49 }, () => ({ ...copy, receipt: undefined } as never)) });
    await db.expense.createMany({ data: Array.from({ length: 30 }, () => ({ ...copy, receipt: undefined, createdAt: new Date(monthStart(new Date()).getTime() - 86_400_000) } as never)) });
    const r = await call("owner", "POST", "/expenses", body());
    expect(r.statusCode).toBe(402);
    expect(r.json()).toMatchObject({ code: "limit_reached" });
    expect(await db.expense.count({ where: { tenantId: ids.biz, createdAt: { gte: monthStart(new Date()) } } })).toBe(50);
  });
});
