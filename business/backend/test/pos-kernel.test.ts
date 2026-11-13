// Tests for the point of sale and stock on the kernel (P2-W4): what the move to apps/pos/backend added. operations.test.ts and stock.test.ts (the old tests)
// are NOT repeated here and pass unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers the kernel columns, the events written with each change, a stale version (409) on a menu item and a stock item, a bill voided only once,
// a shift closed only once, and isolation (another business can't change these).
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
const call = (who: string, method: "GET" | "POST" | "PATCH", url: string, body: object | undefined, tenant: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant } });
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.hotel, name } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, menu_items, shifts, pos_bills, stock_items, stock_moves, stock_recipes, audit_logs, event_outbox RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-pos.test`, userName: `kpos-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Inn", type: "hotel", planId: "hotel-business" }))).id;
  ids.otherHotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Inn", type: "hotel", planId: "hotel-business" }))).id;
});
afterAll(async () => { await app.close(); });

describe("Point of sale on the kernel", () => {
  it("adds menu items with the kernel columns and refuses a change made on an old version", async () => {
    expect((await call("owner", "POST", "/menu", { items: [{ name: "Masala tea", price: 120, category: "Drinks" }] }, ids.hotel!)).statusCode).toBe(200);
    const m = (await call("owner", "GET", "/menu", undefined, ids.hotel!)).json().data[0];
    expect(m).toMatchObject({ version: 1, createdBy: ids.owner, deletedAt: null });
    expect(await events("pos.menu.added")).toHaveLength(1);
    expect((await call("owner", "PATCH", `/menu/${m.id}`, { price: 130, version: 1 }, ids.hotel!)).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/menu/${m.id}`, { price: 140, version: 1 }, ids.hotel!)).statusCode).toBe(409);
    expect((await call("other", "PATCH", `/menu/${m.id}`, { price: 1 }, ids.otherHotel!)).statusCode).toBe(404);
    ids.item = m.id;
  });

  it("writes an event with each paid bill, voids a bill only once, and closes a shift only once", async () => {
    await call("owner", "POST", "/shifts/open", { float: 1000 }, ids.hotel!);
    expect(await events("pos.shift.opened")).toHaveLength(1);
    const bill = (await call("owner", "POST", "/pos/bills", { outlet: "Café", method: "cash", lines: [{ itemId: ids.item, name: "x", qty: 1, price: 1 }] }, ids.hotel!)).json().data;
    expect(bill.subtotal).toBe(130);   // the menu price wins
    expect((await events("pos.bill.paid")).map((e) => (e.payload as { id: string }).id)).toEqual([bill.id]);
    expect((await call("owner", "POST", `/pos/bills/${bill.id}/void`, { note: "Wrong table" }, ids.hotel!)).statusCode).toBe(200);
    expect((await call("owner", "POST", `/pos/bills/${bill.id}/void`, { note: "Again" }, ids.hotel!)).statusCode).toBe(404);
    expect(await events("pos.bill.voided")).toHaveLength(1);
    expect((await call("owner", "POST", "/shifts/close", { counted: 1000 }, ids.hotel!)).json().message).toBe("Shift closed. The cash matches.");
    expect((await call("owner", "POST", "/shifts/close", { counted: 1000 }, ids.hotel!)).statusCode).toBe(400);
    expect(await events("pos.shift.closed")).toHaveLength(1);
  });
});

describe("Stock on the kernel", () => {
  it("adds an item with an event and its opening stock, refuses a stale change, and keeps other businesses out", async () => {
    const r = await call("owner", "POST", "/stock", { name: "Mineral water", place: "bar", unit: "bottle", qty: 24, min: 6, cost: 20 }, ids.hotel!);
    expect(r.statusCode).toBe(200);
    const id = r.json().data.id as string;
    expect(await app.db!.stockItem.findUniqueOrThrow({ where: { id } })).toMatchObject({ qty: 24, version: 1, createdBy: ids.owner });
    expect(await events("pos.stock.added")).toHaveLength(1);
    expect((await call("owner", "PATCH", `/stock/${id}`, { min: 8, version: 1 }, ids.hotel!)).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/stock/${id}`, { min: 9, version: 1 }, ids.hotel!)).statusCode).toBe(409);
    expect((await call("owner", "POST", `/stock/${id}/out`, { qty: 4 }, ids.hotel!)).json().data.qty).toBe(20);
    expect((await events("pos.stock.moved")).map((e) => (e.payload as { after: number }).after)).toEqual([20]);
    expect((await call("other", "POST", `/stock/${id}/in`, { qty: 1 }, ids.otherHotel!)).statusCode).toBe(404);
  });
});
