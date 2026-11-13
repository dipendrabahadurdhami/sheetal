// Rentals leftovers of Phase 2 (P2-W6): money also kept in paisa (the database trigger keeps every *_paisa column equal to rupees × 100, on every
// writer), and owners, units, payments and statements removed with a soft delete that every other reader skips (the page, the branch-closing check,
// profit, the website's "my rent" page). rentals.test.ts and rentals-kernel.test.ts (the old tests) pass unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { runRentBills } from "@sheetal/app-rentals/backend/bills";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.agency! } });
const LEASE = { start: "2025-01-01", end: "2025-12-31", renter: "Sita Sharma", phone: "9800000000", rent: 20_000, deposit: 40_000, dueDay: 7, lateFeePct: 2, lateAfterDays: 5 };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, rent_owners, rent_units, rent_leases, rent_bills, rent_payments, rent_repairs, owner_statements RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@rent-paisa.test`, userName: `rp-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Paisa Realty", type: "agency", planId: "agency-business" }))).id;
  ids.second = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
});
afterAll(async () => { await app.close(); });

describe("money in paisa, kept by the database", () => {
  it("every rentals amount has its paisa twin, on create and on every change", async () => {
    const owner = (await call("owner", "POST", "/rentals/owners", { name: "Ram", feePct: 8, branchId: ids.head })).json().data.id as string;
    const unit = (await call("owner", "POST", "/rentals/units", { ownerId: owner, property: "Sanepa", name: "Flat 1", kind: "2 BHK", rent: 20_000 })).json().data.id as string;
    expect(await app.db!.rentUnit.findUniqueOrThrow({ where: { id: unit } })).toMatchObject({ rent: 20_000, rentPaisa: 2_000_000n });
    const lease = (await call("owner", "POST", "/rentals/leases", { ...LEASE, unitId: unit })).json().data.id as string;
    expect(await app.db!.rentLease.findUniqueOrThrow({ where: { id: lease } })).toMatchObject({ rentPaisa: 2_000_000n, depositPaisa: 4_000_000n, depositReturnedPaisa: null });
    await runRentBills(app.db!, { today: "2025-03-03", tenantId: ids.agency });
    const bill = await app.db!.rentBill.findFirstOrThrow({ where: { leaseId: lease, month: "2025-03" } });
    expect(bill).toMatchObject({ amount: 20_000, amountPaisa: 2_000_000n, paid: 0, paidPaisa: 0n });
    const pay = await call("owner", "POST", `/rentals/bills/${bill.id}/payments`, { amount: 5_500, method: "bank", paidOn: "2025-03-21", ref: "NIC-1" });
    expect(pay.statusCode).toBe(200);
    expect(await app.db!.rentBill.findUniqueOrThrow({ where: { id: bill.id } })).toMatchObject({ paid: 5_500, paidPaisa: 550_000n });   // an increment keeps its twin too
    expect(await app.db!.rentPayment.findFirstOrThrow({ where: { billId: bill.id } })).toMatchObject({ amountPaisa: 550_000n });
    ids.owner1 = owner; ids.unit1 = unit; ids.bill1 = bill.id;
  });
});

describe("soft delete of owners, units, payments and statements", () => {
  it("a removed payment stays as a row, leaves the page, and comes off the bill", async () => {
    const p = await app.db!.rentPayment.findFirstOrThrow({ where: { billId: ids.bill1 } });
    expect((await call("owner", "DELETE", `/rentals/payments/${p.id}`)).statusCode).toBe(200);
    expect(await app.db!.rentPayment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ deletedBy: ids.owner, version: p.version + 1 });
    expect((await app.db!.rentPayment.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).not.toBeNull();
    expect(await app.db!.rentBill.findUniqueOrThrow({ where: { id: ids.bill1! } })).toMatchObject({ paid: 0, paidPaisa: 0n });
    const shown = (await call("owner", "GET", `/rentals/bills/${ids.bill1}`)).json().data;
    expect(JSON.stringify(shown)).not.toContain(p.id);
    expect((await call("owner", "DELETE", `/rentals/payments/${p.id}`)).statusCode).toBe(404);   // already removed
  });

  it("a removed statement stops counting and can be saved again for the same month", async () => {
    expect((await call("owner", "POST", "/rentals/statements", { ownerId: ids.owner1, month: "2025-03" })).statusCode).toBe(200);
    const s = await app.db!.ownerStatement.findFirstOrThrow({ where: { ownerId: ids.owner1, month: "2025-03" } });
    expect((await call("owner", "DELETE", `/rentals/statements/${s.id}`)).statusCode).toBe(200);
    expect((await app.db!.ownerStatement.findUniqueOrThrow({ where: { id: s.id } })).deletedAt).not.toBeNull();
    expect((await call("owner", "POST", "/rentals/statements", { ownerId: ids.owner1, month: "2025-03" })).statusCode).toBe(200);
    expect(await app.db!.ownerStatement.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ deletedAt: null, deletedBy: null });
  });

  it("a removed owner (no units) is hidden, kept as a row, and no longer blocks closing its branch", async () => {
    const pk = (await app.db!.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
    const o = (await call("owner", "POST", "/rentals/owners", { name: "Short stay", feePct: 8, branchId: pk })).json().data.id as string;
    const blocked = await call("owner", "PATCH", `/branches/${pk}`, { status: "closed" });
    expect(blocked.statusCode).toBeGreaterThanOrEqual(400);
    expect((await call("owner", "DELETE", `/rentals/owners/${o}`)).statusCode).toBe(200);
    expect((await app.db!.rentOwner.findUniqueOrThrow({ where: { id: o } })).deletedAt).not.toBeNull();
    const page = (await call("owner", "GET", "/rentals")).json().data;
    expect(JSON.stringify(page)).not.toContain(o);
    expect((await call("owner", "PATCH", `/branches/${pk}`, { status: "closed" })).statusCode).toBe(200);
  });

  it("another business's rows are not found, and a removed unit is hidden", async () => {
    expect((await call("other", "DELETE", `/rentals/owners/${ids.owner1}`, undefined, ids.second)).statusCode).toBe(404);
    const o = (await call("owner", "POST", "/rentals/owners", { name: "Empty owner", feePct: 8, branchId: ids.head })).json().data.id as string;
    const u = (await call("owner", "POST", "/rentals/units", { ownerId: o, property: "Baneshwor", name: "Shop 2", kind: "Shop", rent: 9_000 })).json().data.id as string;
    expect((await call("owner", "DELETE", `/rentals/units/${u}`)).statusCode).toBe(200);
    expect((await app.db!.rentUnit.findUniqueOrThrow({ where: { id: u } })).deletedAt).not.toBeNull();
    expect(JSON.stringify((await call("owner", "GET", "/rentals")).json().data)).not.toContain(u);
    expect((await call("owner", "DELETE", `/rentals/owners/${o}`)).statusCode).toBe(200);   // its only unit is removed, so the owner can go
  });
});
