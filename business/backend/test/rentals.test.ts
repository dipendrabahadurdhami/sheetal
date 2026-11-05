import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { runRentBills } from "@sheetal/backend-core/domain/rentals";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });
const page = async (who = "owner") => (await call(who, "GET", "/rentals")).json().data;
// A lease in 2025, so the page (which makes bills for the real month) never adds one; tests make bills with a set day.
const LEASE = { start: "2025-01-01", end: "2025-12-31", renter: "Sita Sharma", phone: "9800000000", rent: 20_000, deposit: 40_000, dueDay: 7, lateFeePct: 2, lateAfterDays: 5 };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, rent_owners, rent_units, rent_leases, rent_bills, rent_payments, rent_repairs, owner_statements, expenses, recurring_expenses, biz_invoices, doc_counters, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "accountant", "agent", "pokhara"]) {
    const u = await db.user.create({ data: { email: `${k}@everest.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } });
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.accountant!, roleId: (await role("accountant")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.pokhara!, roleId: (await role("accountant")).id, status: "active", scopes: ["Pokhara"] } });
});
afterAll(async () => { await app.close(); });

describe("rentals", () => {
  it("lets the owner and the accountant in, and keeps the agent out", async () => {
    expect((await call("agent", "GET", "/rentals")).statusCode).toBe(403);
    expect((await call("agent", "POST", "/rentals/owners", { name: "X", branchId: ids.head })).statusCode).toBe(403);
    expect((await call("accountant", "GET", "/rentals")).statusCode).toBe(200);
  });

  it("adds an owner, a unit and a lease, and keeps one lease per unit", async () => {
    const o = await call("owner", "POST", "/rentals/owners", { name: "Ram Thapa", feePct: 8, bank: "NIC Asia 0012", branchId: ids.head });
    expect(o.statusCode).toBe(200);
    ids.ownerA = o.json().data.id;
    expect((await call("owner", "POST", "/rentals/units", { ownerId: ids.ownerA, property: "Sanepa Apartments", name: "Flat 3A", kind: "2 BHK", rent: 20_000 })).statusCode).toBe(200);
    ids.unit = (await page()).units[0].id;
    expect((await call("owner", "POST", "/rentals/leases", { ...LEASE, unitId: ids.unit, end: "2024-12-31" })).statusCode).toBe(400);
    expect((await call("owner", "POST", "/rentals/leases", { ...LEASE, unitId: ids.unit, start: "soon" })).statusCode).toBe(422);
    expect((await call("owner", "POST", "/rentals/leases", { ...LEASE, unitId: ids.unit, dueDay: 31 })).statusCode).toBe(422);
    const l = await call("owner", "POST", "/rentals/leases", { ...LEASE, unitId: ids.unit });
    expect(l.statusCode).toBe(200);
    expect(l.json().data.no).toMatch(/^LS-\d{4}$/);
    ids.lease = l.json().data.id;
    expect((await call("owner", "POST", "/rentals/leases", { ...LEASE, unitId: ids.unit })).statusCode).toBe(400);
    const p = await page();
    expect(p.units[0]).toMatchObject({ status: "let", lease: { renter: "Sita Sharma" } });
    expect(p.bills).toHaveLength(0);
  });

  it("makes one bill per lease and month, and adds a late fee once", async () => {
    const db = app.db!;
    expect(await runRentBills(db, { today: "2025-03-10", tenantId: ids.agency })).toEqual({ bills: 1, lateFees: 0 }); // within the 5 grace days
    expect(await runRentBills(db, { today: "2025-03-20", tenantId: ids.agency })).toEqual({ bills: 0, lateFees: 1 });
    expect(await runRentBills(db, { today: "2025-03-25", tenantId: ids.agency })).toEqual({ bills: 0, lateFees: 0 });
    const bill = (await page()).bills[0];
    expect(bill).toMatchObject({ month: "2025-03", due: "2025-03-07", amount: 20_000, lateFee: 400, balance: 20_400, status: "overdue" });
    ids.march = bill.id;
  });

  it("records payments up to what is owed, and never above it", async () => {
    const pay = (amount: number, who = "owner") => call(who, "POST", `/rentals/bills/${ids.march}/payments`, { amount, method: "bank", paidOn: "2025-03-21", ref: "NIC-1" });
    expect((await pay(10_000, "agent")).statusCode).toBe(403);
    expect((await pay(10_000)).statusCode).toBe(200);
    expect((await pay(20_000)).statusCode).toBe(400); // only 10,400 is owed
    expect((await call("owner", "PUT", `/rentals/bills/${ids.march}`, { amount: 5_000 })).statusCode).toBe(400); // something is paid
    expect((await pay(10_400)).statusCode).toBe(200);
    expect((await page()).bills[0]).toMatchObject({ paid: 20_400, balance: 0, status: "paid" });
    expect((await pay(1)).statusCode).toBe(400);
  });

  it("waives a late fee, and doesn't add it back", async () => {
    const db = app.db!;
    await runRentBills(db, { today: "2025-04-30", tenantId: ids.agency });
    const april = (await page()).bills.find((b: { month: string }) => b.month === "2025-04");
    expect(april.lateFee).toBe(400);
    expect((await call("owner", "POST", `/rentals/bills/${april.id}/waive`)).statusCode).toBe(200);
    await runRentBills(db, { today: "2025-05-01", tenantId: ids.agency });
    expect((await page()).bills.find((b: { month: string }) => b.month === "2025-04")).toMatchObject({ lateFee: 0, lateWaived: true });
    expect((await call("owner", "PUT", `/rentals/bills/${april.id}`, { amount: 15_000 })).statusCode).toBe(200); // nothing paid yet
    expect((await call("owner", "POST", `/rentals/leases/${ids.lease}/bills`, { month: "2025-04" })).statusCode).toBe(400); // already there
    expect((await call("owner", "POST", `/rentals/leases/${ids.lease}/bills`, { month: "2025-02" })).statusCode).toBe(200); // a missed month
  });

  it("makes the owner statement: rent collected − fee − repairs, and counts only the fee in profit", async () => {
    const r = await call("owner", "POST", "/rentals/repairs", { unitId: ids.unit, title: "Water heater", cost: 3_000, status: "done", doneOn: "2025-03-25" });
    expect(r.statusCode).toBe(200);
    const st = (await call("owner", "GET", "/rentals/statements?month=2025-03")).json().data.rows[0];
    // 20,400 collected (rent and late fee), 8% fee = 1,632, repairs 3,000, owed to the owner 15,768.
    expect(st).toMatchObject({ owner: "Ram Thapa", collected: 20_400, fee: 1_632, repairs: 3_000, payable: 15_768, saved: null });
    const profit = async () => (await call("owner", "GET", "/expenses/profit?from=2025-03&to=2025-03")).json().data.totals;
    expect((await profit()).direct).toBe(0); // rent is the owner's money
    expect((await call("accountant", "POST", "/rentals/statements", { ownerId: ids.ownerA, month: "2025-03" })).statusCode).toBe(200);
    expect(await profit()).toMatchObject({ direct: 1_632, profit: 1_632 });
    const saved = (await call("owner", "GET", "/rentals/statements?month=2025-03")).json().data.rows[0].saved;
    expect(saved).toMatchObject({ fee: 1_632, current: true });
    expect((await call("owner", "DELETE", `/rentals/statements/${saved.id}`)).statusCode).toBe(200);
    expect((await profit()).direct).toBe(0);
  });

  it("ends a lease, returns part of the deposit, and frees the unit", async () => {
    expect((await call("owner", "POST", `/rentals/leases/${ids.lease}/end`, { endedOn: "2025-06-30", depositReturned: 50_000 })).statusCode).toBe(400); // more than held
    expect((await call("owner", "POST", `/rentals/leases/${ids.lease}/end`, { endedOn: "2025-06-30", depositReturned: 35_000, depositNote: "Rs. 5,000 for a broken window" })).statusCode).toBe(200);
    const p = await page();
    expect(p.leases[0]).toMatchObject({ status: "ended", depositStatus: "returned", depositReturned: 35_000 });
    expect(p.units[0].status).toBe("vacant");
    expect((await call("owner", "DELETE", `/rentals/units/${ids.unit}`)).statusCode).toBe(400); // has history
    expect((await call("owner", "DELETE", `/rentals/owners/${ids.ownerA}`)).statusCode).toBe(400); // owns a unit
  });

  it("confirms online payments made to the business, and leaves Sheetal's to Sheetal", async () => {
    const db = app.db!;
    const feb = await db.rentBill.findFirstOrThrow({ where: { month: "2025-02" } });
    const mk = (collectedBy: string) => db.rentPayment.create({ data: { tenantId: ids.agency!, branchId: feb.branchId, billId: feb.id, amount: 5_000, method: "esewa", paidOn: new Date("2025-02-10"), ref: "ES-1", status: "pending", source: "online", collectedBy } });
    const own = await mk("business");
    const sheetal = await mk("sheetal");
    expect((await page()).pending).toHaveLength(2);
    expect((await call("owner", "POST", `/rentals/payments/${sheetal.id}/confirm`)).statusCode).toBe(403);
    expect((await call("agent", "POST", `/rentals/payments/${own.id}/confirm`)).statusCode).toBe(403);
    expect((await call("owner", "POST", `/rentals/payments/${own.id}/confirm`)).statusCode).toBe(200);
    expect((await call("owner", "POST", `/rentals/payments/${own.id}/confirm`)).statusCode).toBe(400);
    expect((await db.rentBill.findUniqueOrThrow({ where: { id: feb.id } })).paid).toBe(feb.paid + 5_000);
    expect((await call("owner", "POST", `/rentals/payments/${sheetal.id}/reject`, { note: "Not seen" })).statusCode).toBe(403);
    expect((await call("owner", "DELETE", `/rentals/payments/${sheetal.id}`)).statusCode).toBe(400);
  });

  it("keeps branch-limited people to their branches", async () => {
    const p = await page("pokhara");
    expect(p.units).toHaveLength(0);
    expect(p.bills).toHaveLength(0);
    expect((await call("pokhara", "POST", `/rentals/bills/${ids.march}/payments`, { amount: 1, method: "cash", paidOn: "2025-03-21" })).statusCode).toBe(404);
    expect((await call("pokhara", "POST", "/rentals/owners", { name: "Hari", branchId: ids.head })).statusCode).toBe(403);
  });
});
