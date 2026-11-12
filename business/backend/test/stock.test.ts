import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { lowStock, reverseSale, runLowStock, saleMoves } from "@sheetal/backend-core/domain/stock";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-stock-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: object, branch?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.hotel!, ...(branch ? { "x-branch": branch } : {}) } });
const add = (over: object = {}, who = "owner") => call(who, "POST", "/stock", { name: "Mineral water", place: "bar", unit: "bottle", qty: 10, min: 4, cost: 20, branchId: ids.head, ...over });
const qtyOf = async (id: string) => (await app.db!.stockItem.findUniqueOrThrow({ where: { id } })).qty;
const bill = (itemId: string, qty: number, who = "owner") => call(who, "POST", "/pos/bills", { outlet: "Bar", method: "fonepay", lines: [{ itemId, name: "Rum shot", qty, price: 300 }] }, ids.head);

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, doc_counters, stock_moves, stock_recipes, stock_items, menu_items, pos_bills RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "cashier", "frontdesk", "housekeeping", "pokhara"]) {
    const u = await db.user.create({ data: { email: `${k}@lake.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  const plan = PLANS.find((p) => p.type === "hotel" && p.price > 0)!;
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lake View Hotel", type: "hotel", planId: plan.id }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.hotel, name: "Head office" } })).id;
  ids.pokharaBranch = (await db.branch.create({ data: { tenantId: ids.hotel!, name: "Pokhara" } })).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.hotel, key } });
  const join_ = async (who: string, key: string, scopes?: string[]) => db.membership.create({ data: { tenantId: ids.hotel!, userId: ids[who]!, roleId: (await role(key)).id, status: "active", ...(scopes ? { scopes } : {}) } });
  await join_("cashier", "cashier");
  await join_("frontdesk", "frontdesk");
  await join_("housekeeping", "housekeeping");
  await join_("pokhara", "cashier", ["Pokhara"]);
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("who can use stock", () => {
  it("keeps housekeeping out, lets the front desk look, and lets the cashier change", async () => {
    expect((await call("housekeeping", "GET", "/stock")).statusCode).toBe(403);
    expect((await call("housekeeping", "GET", "/stock/moves")).statusCode).toBe(403);
    expect((await call("frontdesk", "GET", "/stock")).statusCode).toBe(200);
    expect((await add({}, "frontdesk")).statusCode).toBe(403);
    expect((await add({ name: "Soda" }, "cashier")).statusCode).toBe(200);
  });

  it("checks the input: 422 for a bad form, 400 for a rule", async () => {
    expect((await add({ name: "" })).statusCode).toBe(422);
    expect((await add({ place: "garage" })).statusCode).toBe(422);
    expect((await add({ qty: -1 })).statusCode).toBe(422);
    expect((await add({ qty: 1.5 })).statusCode).toBe(422);
    expect((await add({ name: "soda" })).statusCode).toBe(400);
  });
});

describe("branches", () => {
  it("shows branch-limited people only their branch and keeps them out of the others", async () => {
    const head = (await add({ name: "Head tea", place: "kitchen" })).json().data.id as string;
    expect((await add({ name: "Lake tea", place: "kitchen", branchId: ids.pokharaBranch })).statusCode).toBe(200);
    const mine = (await call("pokhara", "GET", "/stock")).json().data.items as { branch: string }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => i.branch === "Pokhara")).toBe(true);
    expect((await add({ name: "Sneaky", branchId: ids.head }, "pokhara")).statusCode).toBe(403);
    expect((await call("pokhara", "POST", `/stock/${head}/in`, { qty: 5 })).statusCode).toBe(404);
    expect((await call("pokhara", "GET", "/stock", undefined, ids.head)).statusCode).toBe(403);
  });

  it("stops a branch with stock items from being removed", async () => {
    const r = await call("owner", "DELETE", `/branches/${ids.pokharaBranch}`);
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toContain("stock item");
  });
});

describe("stock in, out and waste", () => {
  it("never goes below 0, and says what is left", async () => {
    const id = (await add({ name: "Tissue", place: "housekeeping", unit: "box", qty: 5, min: 0 })).json().data.id as string;
    expect((await call("owner", "POST", `/stock/${id}/out`, { qty: 6 })).statusCode).toBe(400);
    expect(await qtyOf(id)).toBe(5);
    expect((await call("owner", "POST", `/stock/${id}/out`, { qty: 5 })).statusCode).toBe(200);
    expect(await qtyOf(id)).toBe(0);
    expect((await call("owner", "POST", `/stock/${id}/out`, { qty: 1 })).statusCode).toBe(400);
    expect((await call("owner", "POST", `/stock/${id}/out`, { qty: 0 })).statusCode).toBe(422);
  });

  it("asks what happened to waste and keeps the history", async () => {
    const id = (await add({ name: "Eggs", place: "kitchen", unit: "piece", qty: 30, min: 0 })).json().data.id as string;
    expect((await call("owner", "POST", `/stock/${id}/out`, { qty: 3, kind: "waste" })).statusCode).toBe(400);
    expect((await call("owner", "POST", `/stock/${id}/out`, { qty: 3, kind: "waste", note: "Dropped tray" })).statusCode).toBe(200);
    expect((await call("owner", "POST", `/stock/${id}/in`, { qty: 12, cost: 15, supplier: "Sita Traders" })).statusCode).toBe(200);
    const moves = (await call("owner", "GET", `/stock/moves?itemId=${id}`)).json().data.rows as { kind: string; qty: number; after: number; note: string }[];
    expect(moves.map((m) => [m.kind, m.qty, m.after])).toEqual([["in", 12, 39], ["waste", -3, 27], ["in", 30, 30]]);
    expect(moves[0]!.note).toContain("Sita Traders");
    expect((await call("owner", "GET", `/stock/moves?itemId=${id}&kind=waste`)).json().data.rows).toHaveLength(1);
    expect((await call("owner", "GET", "/stock/moves?from=soon")).statusCode).toBe(422);
  });

  it("keeps the cost at the average of what was bought", async () => {
    const id = (await add({ name: "Rice", place: "store", unit: "kg", qty: 10, cost: 20, min: 0 })).json().data.id as string;
    await call("owner", "POST", `/stock/${id}/in`, { qty: 10, cost: 30 });
    expect((await app.db!.stockItem.findUniqueOrThrow({ where: { id } })).cost).toBe(25);
  });

  it("archives an item and refuses changes to it until it is restored", async () => {
    const id = (await add({ name: "Old jar", place: "store", unit: "piece", qty: 1, min: 0 })).json().data.id as string;
    expect((await call("owner", "PATCH", `/stock/${id}`, { active: false })).statusCode).toBe(200);
    expect((await call("owner", "POST", `/stock/${id}/in`, { qty: 1 })).statusCode).toBe(400);
    expect((await call("owner", "GET", "/stock")).json().data.items.some((i: { id: string }) => i.id === id)).toBe(false);
    expect((await call("owner", "PATCH", `/stock/${id}`, { active: true })).statusCode).toBe(200);
    expect((await call("owner", "POST", `/stock/${id}/in`, { qty: 1 })).statusCode).toBe(200);
  });
});

describe("counting", () => {
  it("sets the level and records the difference", async () => {
    const id = (await add({ name: "Whisky", place: "bar", unit: "bottle", qty: 10, min: 0 })).json().data.id as string;
    const more = await call("owner", "POST", `/stock/${id}/count`, { counted: 12 });
    expect(more.json().data).toEqual({ qty: 12, diff: 2 });
    const fewer = await call("owner", "POST", `/stock/${id}/count`, { counted: 7, note: "Monthly count" });
    expect(fewer.json().data).toEqual({ qty: 7, diff: -5 });
    expect((await call("owner", "POST", `/stock/${id}/count`, { counted: 7 })).json().data.diff).toBe(0);
    expect((await call("owner", "POST", `/stock/${id}/count`, { counted: -1 })).statusCode).toBe(422);
    const last = (await call("owner", "GET", `/stock/moves?itemId=${id}&kind=count`)).json().data.rows as { qty: number; after: number }[];
    expect(last.map((m) => [m.qty, m.after])).toEqual([[0, 7], [-5, 7], [2, 12]]);
  });
});

describe("point of sale", () => {
  const menu: Record<string, string> = {};
  const stockIds: Record<string, string> = {};
  beforeAll(async () => {
    menu.shot = (await app.db!.menuItem.create({ data: { tenantId: ids.hotel!, outlet: "Bar", category: "Spirits", name: "Rum shot", price: 300 } })).id;
    menu.plain = (await app.db!.menuItem.create({ data: { tenantId: ids.hotel!, outlet: "Bar", category: "Soft", name: "Tea", price: 100 } })).id;
    stockIds.rum = (await add({ name: "Rum", place: "bar", unit: "ml", qty: 100, min: 0 })).json().data.id as string;
  });

  it("saves a recipe and refuses a stock item from nowhere", async () => {
    expect((await call("frontdesk", "PUT", `/stock/recipes/${menu.shot}`, { lines: [] })).statusCode).toBe(403);
    expect((await call("owner", "PUT", `/stock/recipes/${menu.shot}`, { lines: [{ itemId: "nope", qty: 30 }] })).statusCode).toBe(400);
    expect((await call("owner", "PUT", `/stock/recipes/${menu.shot}`, { lines: [{ itemId: stockIds.rum, qty: 30 }] })).statusCode).toBe(200);
    const shot = (await call("owner", "GET", "/stock/recipes")).json().data.menu.find((m: { id: string }) => m.id === menu.shot);
    expect(shot.lines).toEqual([{ itemId: stockIds.rum, name: "Rum", place: "bar", unit: "ml", qty: 30 }]);
  });

  it("takes stock out when a bill is paid and puts it back when the bill is voided", async () => {
    const r = await bill(menu.shot!, 2);
    expect(r.statusCode).toBe(200);
    expect(await qtyOf(stockIds.rum!)).toBe(40);
    const sale = await app.db!.stockMove.findMany({ where: { kind: "sale", ref: r.json().data.id } });
    expect(sale.map((m) => m.qty)).toEqual([-60]);
    expect((await call("owner", "POST", `/pos/bills/${r.json().data.id}/void`, { note: "Wrong table" })).statusCode).toBe(200);
    expect(await qtyOf(stockIds.rum!)).toBe(100);
    // Doing it again changes nothing.
    expect(await reverseSale(app.db!, r.json().data.id)).toBe(0);
    expect(await saleMoves(app.db!, r.json().data.id)).toBe(0);
    expect(await qtyOf(stockIds.rum!)).toBe(100);
  });

  it("leaves a bill with no recipe alone, and never blocks a sale when stock is short", async () => {
    const before = await app.db!.stockMove.count();
    expect((await bill(menu.plain!, 3)).statusCode).toBe(200);
    expect(await app.db!.stockMove.count()).toBe(before);
    await call("owner", "POST", `/stock/${stockIds.rum}/count`, { counted: 40 });
    const r = await bill(menu.shot!, 2);
    expect(r.statusCode).toBe(200);
    expect(await qtyOf(stockIds.rum!)).toBe(0);
    await call("owner", "POST", `/pos/bills/${r.json().data.id}/void`, { note: "Test" });
    expect(await qtyOf(stockIds.rum!)).toBe(40);
  });
});

describe("CSV", () => {
  it("imports with the sample's columns, adds new items and counts existing ones", async () => {
    const rows = [
      { name: "Cooking oil", place: "Kitchen", unit: "litre", qty: 20, min: 5, cost: 210 },
      { name: "Towels", place: "housekeeping", unit: "piece", qty: "60", min: "", cost: "" },
    ];
    expect((await call("owner", "POST", "/stock/import", { rows, branchId: ids.head })).json().message).toBe("2 added, 0 updated.");
    const again = await call("owner", "POST", "/stock/import", { rows: [{ ...rows[0], qty: 18 }], branchId: ids.head });
    expect(again.json().message).toBe("0 added, 1 updated.");
    const oil = await app.db!.stockItem.findFirstOrThrow({ where: { tenantId: ids.hotel, name: "Cooking oil" } });
    expect([oil.qty, oil.place, oil.min, oil.cost]).toEqual([18, "kitchen", 5, 210]);
    expect((await app.db!.stockMove.findMany({ where: { itemId: oil.id }, orderBy: { createdAt: "asc" } })).map((m) => [m.kind, m.qty])).toEqual([["in", 20], ["count", -2]]);
  });

  it("imports nothing when a row is wrong, and keeps the front desk out", async () => {
    const before = await app.db!.stockItem.count();
    const r = await call("owner", "POST", "/stock/import", { rows: [{ name: "Fine", place: "bar", unit: "x", qty: 1 }, { name: "Bad", place: "garage", unit: "x", qty: 1 }], branchId: ids.head });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toContain("Row 2");
    expect((await call("owner", "POST", "/stock/import", { rows: [{ name: "Half", place: "bar", unit: "x", qty: 1.5 }], branchId: ids.head })).statusCode).toBe(400);
    expect(await app.db!.stockItem.count()).toBe(before);
    expect((await call("frontdesk", "POST", "/stock/import", { rows: [{ name: "Fine", place: "bar", unit: "x", qty: 1 }] }, ids.head)).statusCode).toBe(403);
  });

  it("exports the same columns as the sample", async () => {
    const r = await call("owner", "GET", "/stock/export", undefined, ids.head);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    const lines = r.body.replace("\uFEFF", "").split("\r\n");
    expect(lines[0]).toBe("Item,Place,Unit,In stock,Reorder at,Cost (Rs.)");
    expect(lines).toContain("Cooking oil,Kitchen,litre,18,5,210");
    expect((await call("housekeeping", "GET", "/stock/export")).statusCode).toBe(403);
  });
});

describe("low stock", () => {
  it("lists what is under its reorder level and tells the team once a day", async () => {
    const id = (await add({ name: "Lemons", place: "bar", unit: "kg", qty: 2, min: 5 })).json().data.id as string;
    const low = await lowStock(app.db!, ids.hotel!, ids.head);
    expect(low.map((i) => i.id)).toContain(id);
    expect(low.every((i) => i.qty < i.min)).toBe(true);
    const summary = (await call("owner", "GET", "/stock")).json().data.summary;
    expect(summary.low).toBeGreaterThan(0);
    expect((await call("owner", "GET", "/stock?low=1")).json().data.items.every((i: { low: boolean }) => i.low)).toBe(true);

    const first = await runLowStock(app.db!, { today: nepalDay() });
    expect(first.notes).toBeGreaterThan(0);
    const who = (await app.db!.notification.findMany({ where: { type: "stock.low", tenantId: ids.hotel } })).map((n) => n.userId);
    expect(who).toContain(ids.owner);
    expect(who).toContain(ids.cashier);
    expect(who).not.toContain(ids.housekeeping);
    expect(who).not.toContain(ids.pokhara);
    const again = await runLowStock(app.db!, { today: nepalDay() });
    expect(again.notes).toBe(0);
    expect(await app.db!.notification.count({ where: { type: "stock.low", tenantId: ids.hotel } })).toBe(who.length);
  });
});
