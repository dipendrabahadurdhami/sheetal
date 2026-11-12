// Tests for Rentals on the kernel (P2-W1 stage 1): what the move to apps/rentals/backend added. rentals.test.ts (the old tests) is NOT repeated here and passes unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by backend-core/test/setup-db.ts): npm run test -w @sheetal/business-api
// How it works: a real business API with a few people (owner, accountant, a Pokhara-only accountant, an agent, two custom roles) in "Everest Realty" and one more
// business; calls go through HTTP (app.inject), the database is read straight afterwards to check what was really written.
// Rules: covers isolation (other business, other branch), the new role names and the old ones, version conflict (409), hidden deleted rows, the audit lines with the OLD
// action strings, the events (paisa) written in the same transaction as the change (gone on rollback), a read-only support session, the monthly bill job, and every
// business rule: payment <= owed; amount changes only before anything is paid; deposit held and returned, never income; statement = collected - fee - repairs and the fee
// (only) in profit; online payments count once confirmed, once, never over what is owed; Sheetal's own payments are left to Sheetal; a late fee once, not again after a waive.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { createDb } from "@sheetal/platform/db/client";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { testRepositoryIsolation } from "@sheetal/platform/core/testing/isolation";
import { OwnerRepository } from "@sheetal/app-rentals/backend/owner.repository";
import { billEventsOf } from "@sheetal/app-rentals/backend/host";
import { OwnerService } from "@sheetal/app-rentals/backend/owner.service";
import { PaymentService } from "@sheetal/app-rentals/backend/bill.service";
import { newRepos } from "@sheetal/app-rentals/backend/rental.service";
import { runRentBills } from "@sheetal/app-rentals/backend/bills";
import { rentJob } from "@sheetal/app-rentals/backend";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object, o: { branch?: string; tenant?: string } = {}) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": o.tenant ?? ids.agency!, ...(o.branch ? { "x-branch": o.branch } : {}) } });
const page = async (who = "owner", o: { tenant?: string } = {}) => (await call(who, "GET", "/rentals", undefined, o)).json().data;
const audits = (action: string) => app.db!.auditLog.findMany({ where: { tenantId: ids.agency, action }, orderBy: { createdAt: "asc" } });
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.agency, name }, orderBy: { createdAt: "asc" } });
const LEASE = { start: "2025-01-01", end: "2025-12-31", renter: "Sita Sharma", phone: "9800000000", rent: 20_000, deposit: 40_000, dueDay: 7, lateFeePct: 2, lateAfterDays: 5 };

const addOwner = (over: object = {}, who = "owner", o: { tenant?: string } = {}) => call(who, "POST", "/rentals/owners", { name: "Ram Thapa", feePct: 8, branchId: ids.head, ...over }, o);
const addUnit = async (ownerId: string, name: string) => {
  const r = await call("owner", "POST", "/rentals/units", { ownerId, property: "Sanepa Apartments", name, kind: "2 BHK", rent: 20_000 });
  expect(r.statusCode).toBe(200);
  return r.json().data.id as string;
};
/** An owner, a unit and a 2025 lease (so the page never adds a bill on its own), and one bill made for the given month. */
async function leaseWithBill(label: string, month = "2025-03", over: object = {}) {
  const owner = (await addOwner({ name: `Owner ${label}` })).json().data.id as string;
  const unit = await addUnit(owner, `Flat ${label}`);
  const lease = (await call("owner", "POST", "/rentals/leases", { ...LEASE, unitId: unit, renter: `Renter ${label}`, ...over })).json().data.id as string;
  await runRentBills(app.db!, { today: `${month}-03`, tenantId: ids.agency });
  const bill = await app.db!.rentBill.findFirstOrThrow({ where: { leaseId: lease, month } });
  return { owner, unit, lease, bill };
}
const billOf = (id: string) => app.db!.rentBill.findUniqueOrThrow({ where: { id } });
const pay = (billId: string, amount: number, who = "owner", paidOn = "2025-03-21") => call(who, "POST", `/rentals/bills/${billId}/payments`, { amount, method: "bank", paidOn, ref: "NIC-1" });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, event_outbox, rent_owners, rent_units, rent_leases, rent_bills, rent_payments, rent_repairs, owner_statements, expenses, recurring_expenses, biz_invoices, doc_counters, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "accountant", "agent", "pokhara", "reader", "oldview", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@rent-kernel.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.second = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  ids.otherHead = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.second, name: "Head office" } })).id;
  ids.pk = (await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  const custom = async (key: string, perms: string[]) => (await db.role.create({ data: { tenantId: ids.agency!, key, name: key, system: false, perms } })).id;
  const join = (userId: string, roleId: string, extra: object = {}) => db.membership.create({ data: { tenantId: ids.agency!, userId, roleId, status: "active", ...extra } });
  await join(ids.accountant!, (await role("accountant")).id);
  await join(ids.agent!, (await role("agent")).id);
  await join(ids.pokhara!, (await role("accountant")).id, { scopes: ["Pokhara"] });
  await join(ids.reader!, await custom("reader_new", ["rentals.rental.read:branch"]));      // only the NEW name, read only
  await join(ids.oldview!, await custom("viewer_old", ["rentals.rental.read"]));                    // what the old name rentals.view stood for
});
afterAll(async () => { await app.close(); });

describe("isolation", () => {
  const db = createDb(inject("databaseUrl"))!;
  testRepositoryIsolation("OwnerRepository", {
    db, repo: new OwnerRepository(), model: "rentOwner",
    row: ({ tenantId, branchId, n }) => ({ tenantId, branchId, name: `Iso owner ${n}` }),
    createData: ({ branchId }) => ({ name: "Iso created", feeBp: 800, branchId }),
    update: { data: { name: "changed" }, changedField: "name" },
  });

  it("does not find, change, delete or pay anything of another business (the same answer as for a missing one)", async () => {
    const theirs = (await addOwner({ name: "Their owner", branchId: ids.otherHead }, "other", { tenant: ids.second })).json().data;
    expect(theirs.id).toBeTruthy();
    for (const [method, url, body] of [
      ["PUT", `/rentals/owners/${theirs.id}`, { name: "Mine now" }],
      ["DELETE", `/rentals/owners/${theirs.id}`, undefined],
      ["POST", "/rentals/units", { ownerId: theirs.id, property: "P", name: "U", kind: "2 BHK", rent: 1 }],
      ["POST", `/rentals/bills/${theirs.id}/payments`, { amount: 1, method: "cash", paidOn: "2025-03-21" }],
      ["POST", `/rentals/payments/${theirs.id}/confirm`, {}],
    ] as const) expect((await call("owner", method, url, body)).statusCode, `${method} ${url}`).toBe(404);
    expect((await page()).owners.some((o: { id: string }) => o.id === theirs.id)).toBe(false);
    expect((await call("owner", "GET", "/rentals", undefined, { tenant: ids.second })).statusCode).toBe(403);   // not a member of that business
    expect(await app.db!.rentOwner.findUnique({ where: { id: theirs.id } })).toMatchObject({ name: "Their owner" });
  });

  it("does not find another branch's rows for a branch-limited person", async () => {
    const f = await leaseWithBill("iso-branch");
    const get404 = async (method: "PUT" | "DELETE" | "POST", url: string, body?: object) => {
      const got = await call("pokhara", method, url, body);
      expect(got.statusCode, `${method} ${url}`).toBe(404);
    };
    await get404("PUT", `/rentals/owners/${f.owner}`, { name: "Hijack" });
    await get404("DELETE", `/rentals/owners/${f.owner}`);
    await get404("POST", `/rentals/bills/${f.bill.id}/payments`, { amount: 1, method: "cash", paidOn: "2025-03-21" });
    await get404("POST", `/rentals/leases/${f.lease}/end`, { endedOn: "2025-06-30" });
    await get404("PUT", `/rentals/bills/${f.bill.id}`, { amount: 1 });
    const p = await page("pokhara");
    expect(p.owners.some((o: { id: string }) => o.id === f.owner)).toBe(false);
    expect(p.bills.some((b: { id: string }) => b.id === f.bill.id)).toBe(false);
    expect((await billOf(f.bill.id)).amount).toBe(20_000);
  });

  it("lets the owner's top-bar branch narrow the page, as it always did", async () => {
    await addOwner({ name: "Pokhara owner", branchId: ids.pk });
    const all = (await page()).owners as { branch: string }[];
    expect(new Set(all.map((o) => o.branch))).toEqual(new Set(["Head office", "Pokhara"]));
    const only = (await call("owner", "GET", "/rentals", undefined, { branch: ids.pk })).json().data.owners as { branch: string }[];
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((o) => o.branch === "Pokhara")).toBe(true);
  });
});

describe("permission names", () => {
  it("a role with only the NEW read name reads the page and nothing more", async () => {
    const got = await call("reader", "GET", "/rentals");
    expect(got.statusCode).toBe(200);
    expect(got.json().data.canManage).toBe(false);
    const add = await addOwner({}, "reader");
    expect(add.statusCode).toBe(403);
    expect(add.json().message).toBe("Your role can't change rentals.");
  });
  it("a role with only the OLD rentals.view still reads, and still cannot write", async () => {
    expect((await call("oldview", "GET", "/rentals")).statusCode).toBe(200);
    expect((await call("oldview", "GET", "/rentals/statements?month=2025-03")).statusCode).toBe(200);
    expect((await addOwner({}, "oldview")).statusCode).toBe(403);
    expect((await call("oldview", "POST", "/rentals/repairs", { unitId: "x", title: "t", cost: 1 })).statusCode).toBe(403);
  });
  it("a stored old role (accountant: rentals.manage) can do everything it could; an agent sees nothing", async () => {
    const o = (await addOwner({ name: "By accountant" }, "accountant")).json().data;
    expect((await call("accountant", "PUT", `/rentals/owners/${o.id}`, { name: "By accountant 2", feePct: 9 })).statusCode).toBe(200);
    expect((await call("accountant", "DELETE", `/rentals/owners/${o.id}`)).statusCode).toBe(200);
    const denied = await call("agent", "GET", "/rentals");
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toBe("Your role can't see rentals.");
  });
});

describe("audit lines and events", () => {
  it("writes the old audit action strings and target text, and the new events with paisa", async () => {
    const f = await leaseWithBill("audit");
    const bill = f.bill;
    const no = `RB-${String(bill.seq).padStart(4, "0")}`;
    expect((await audits("rental.owner_added")).map((a) => a.target)).toContain("Owner audit");
    expect((await events("rentals.owner.created")).length).toBeGreaterThan(0);
    expect((await audits("rental.unit_added")).map((a) => a.target)).toContain("Sanepa Apartments · Flat audit");
    expect((await audits("rental.lease_added")).at(-1)?.target).toMatch(/^LS-\d{4} Flat audit Rs\. 20000$/);
    expect((await events("rentals.lease.created")).at(-1)?.payload).toMatchObject({ leaseId: f.lease, rentPaisa: 2_000_000, depositPaisa: 4_000_000, startOn: "2025-01-01", endOn: "2025-12-31" });

    expect(await pay(bill.id, 5_000)).toMatchObject({ statusCode: 200 });
    expect((await audits("rental.payment_added")).at(-1)?.target).toBe(`${no} Rs. 5000 bank`);
    expect((await events("rentals.payment.recorded")).at(-1)?.payload).toMatchObject({ billId: bill.id, amountPaisa: 500_000, method: "bank" });

    const pid = (await app.db!.rentPayment.findFirstOrThrow({ where: { billId: bill.id } })).id;
    expect((await call("owner", "DELETE", `/rentals/payments/${pid}`)).statusCode).toBe(200);
    expect((await audits("rental.payment_removed")).at(-1)?.target).toBe("Rs. 5000 on 2025-03-21");
    expect((await events("rentals.payment.removed")).at(-1)?.payload).toMatchObject({ paymentId: pid, amountPaisa: 500_000 });

    expect((await call("owner", "PUT", `/rentals/bills/${bill.id}`, { amount: 18_000 })).statusCode).toBe(200);
    expect((await audits("rental.bill_changed")).at(-1)?.target).toBe(`${no} Rs. 20000 → 18000`);
    expect((await events("rentals.bill.updated")).at(-1)?.payload).toMatchObject({ billId: bill.id, amountPaisa: 1_800_000, previousAmountPaisa: 2_000_000 });

    expect((await call("owner", "PUT", `/rentals/owners/${f.owner}`, { name: "Owner audit 2", feePct: 9 })).statusCode).toBe(200);
    expect((await audits("rental.owner_changed")).at(-1)?.target).toBe("Owner audit 2");
    expect((await call("owner", "POST", "/rentals/repairs", { unitId: f.unit, title: "Tap", cost: 700, status: "done", doneOn: "2025-03-25" })).statusCode).toBe(200);
    expect((await audits("rental.repair_added")).at(-1)?.target).toMatch(/^WO-\d{4} Tap$/);
    expect((await events("rentals.repair.created")).at(-1)?.payload).toMatchObject({ unitId: f.unit, costPaisa: 70_000, status: "done" });
  });

  it("writes the owner removal lines, and the statement lines, like before", async () => {
    const o = (await addOwner({ name: "Short stay" })).json().data;
    const gone = await call("owner", "DELETE", `/rentals/owners/${o.id}`);
    expect(gone.json().message).toBe("Short stay removed.");
    expect((await audits("rental.owner_removed")).at(-1)?.target).toBe("Short stay");
    expect((await events("rentals.owner.deleted")).at(-1)?.payload).toMatchObject({ ownerId: o.id });
    const f = await leaseWithBill("stmt-audit");
    expect((await call("owner", "POST", "/rentals/statements", { ownerId: f.owner, month: "2025-03" })).statusCode).toBe(200);
    expect((await audits("rental.statement_saved")).length).toBeGreaterThan(0);
    expect((await events("rentals.statement.saved")).at(-1)?.payload).toMatchObject({ ownerId: f.owner, month: "2025-03" });
  });
});

describe("version conflict", () => {
  it("answers 409 version_conflict for a stale version, saves without one, and counts versions up", async () => {
    const o = (await addOwner({ name: "Versioned" })).json().data;
    expect(o.version).toBe(1);
    const put = (version: number | undefined, name: string) => call("owner", "PUT", `/rentals/owners/${o.id}`, { name, feePct: 8, ...(version === undefined ? {} : { version }) });
    const first = await put(1, "Versioned 2");
    expect(first.statusCode).toBe(200);
    expect(first.json().data.version).toBe(2);
    const stale = await put(1, "Versioned 3");
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("version_conflict");
    expect((await app.db!.rentOwner.findUniqueOrThrow({ where: { id: o.id } })).name).toBe("Versioned 2");   // the stale save changed nothing
    expect((await put(2, "Versioned 4")).json().data.version).toBe(3);
    const none = await put(undefined, "Versioned 5");                                                       // the old page sends no version: last write wins
    expect(none.statusCode).toBe(200);
    expect(none.json().data.version).toBe(4);
    expect((await call("owner", "DELETE", `/rentals/owners/${o.id}?version=1`)).statusCode).toBe(409);
    expect(await app.db!.rentOwner.findUnique({ where: { id: o.id } })).not.toBeNull();
    expect((await call("owner", "DELETE", `/rentals/owners/${o.id}?version=4`)).statusCode).toBe(200);
  });

  it("refuses a stale version on a bill's amount, a payment, a waived late fee and a lease change, and writes nothing", async () => {
    const f = await leaseWithBill("stale");
    const v = (await billOf(f.bill.id)).version;
    expect((await call("owner", "PUT", `/rentals/bills/${f.bill.id}`, { amount: 100, version: v + 3 })).statusCode).toBe(409);
    expect((await billOf(f.bill.id)).amount).toBe(20_000);
    expect((await call("owner", "POST", `/rentals/bills/${f.bill.id}/waive`, { version: v + 3 })).statusCode).toBe(409);
    expect((await call("owner", "PUT", `/rentals/bills/${f.bill.id}`, { amount: 19_000, version: v })).statusCode).toBe(200);
  });
});

describe("rows marked deleted are hidden", () => {
  it("never shows, changes or pays a row with deleted_at set", async () => {
    const f = await leaseWithBill("hidden");
    await app.db!.rentBill.update({ where: { id: f.bill.id }, data: { deletedAt: new Date(), deletedBy: ids.owner } });
    expect((await page()).bills.some((b: { id: string }) => b.id === f.bill.id)).toBe(false);
    expect((await pay(f.bill.id, 100)).statusCode).toBe(404);
    expect((await call("owner", "PUT", `/rentals/bills/${f.bill.id}`, { amount: 1 })).statusCode).toBe(404);
    await app.db!.rentOwner.update({ where: { id: f.owner }, data: { deletedAt: new Date(), deletedBy: ids.owner } });
    expect((await page()).owners.some((o: { id: string }) => o.id === f.owner)).toBe(false);
    expect((await call("owner", "PUT", `/rentals/owners/${f.owner}`, { name: "Back?" })).statusCode).toBe(404);
  });
});

describe("the event is written in the same transaction as the change", () => {
  const service = () => new OwnerService({ bus: app.events!.bus, mediaDir: () => undefined, generateBills: async () => 0 }, newRepos());
  const context = () => makeTestContext({ db: app.db!, businessId: ids.agency!, branches: [{ id: ids.head! }, { id: ids.pk! }], userId: ids.owner });
  const traces = async (name: string) => ({
    owners: await app.db!.rentOwner.count({ where: { tenantId: ids.agency, name } }),
    events: (await app.db!.eventOutbox.findMany({ where: { tenantId: ids.agency, name: "rentals.owner.created" } })).length,
    audits: (await audits("rental.owner_added")).filter((a) => a.target === name).length,
  });

  it("commits the row, the audit line and the event together", async () => {
    const before = (await traces("Atomic A")).events;
    const row = await context().transaction((tx) => service().create(tx, { name: "Atomic A", feePct: 8, branchId: ids.head }));
    expect(row.feeBp).toBe(800);
    expect(await traces("Atomic A")).toEqual({ owners: 1, events: before + 1, audits: 1 });
  });

  it("leaves nothing behind when the transaction rolls back", async () => {
    const before = (await traces("Atomic B")).events;
    await expect(context().transaction(async (tx) => {
      await service().create(tx, { name: "Atomic B", feePct: 8, branchId: ids.head });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await traces("Atomic B")).toEqual({ owners: 0, events: before, audits: 0 });
  });
});

describe("a read-only support session", () => {
  const REFUSED = { statusCode: 403, message: "This is a read-only support session. Changes are not allowed." };
  const deps = () => ({ bus: app.events!.bus, mediaDir: () => undefined, generateBills: async () => 0 });
  const readOnly = () => ({
    ...makeTestContext({ db: app.db!, businessId: ids.agency!, branches: [{ id: ids.head! }, { id: ids.pk! }], userId: ids.owner }),
    actor: { kind: "staff" as const, staffId: "support-1", name: "Support", role: "support" },
    impersonation: { staffId: "support-1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 15 * 60_000), readOnly: true },
  });
  const counts = async () => ({
    owners: await app.db!.rentOwner.count(), payments: await app.db!.rentPayment.count(), bills: await app.db!.rentBill.count(),
    audits: await app.db!.auditLog.count(), events: await app.db!.eventOutbox.count(),
  });

  it("can read, but is refused on every write, and nothing is written", async () => {
    const f = await leaseWithBill("readonly");
    const repos = newRepos();
    const owners = new OwnerService(deps(), repos), payments = new PaymentService(deps(), repos), ctx = readOnly();
    const before = await counts();
    await expect(owners.get(ctx, f.owner)).resolves.toMatchObject({ id: f.owner });
    for (const [what, run] of [
      ["add owner", () => owners.create(ctx, { name: "Nope", feePct: 8, branchId: ids.head })],
      ["change owner", () => owners.update(ctx, f.owner, { name: "Nope" })],
      ["remove owner", () => owners.discard(ctx, f.owner)],
      ["record payment", () => payments.record(ctx, f.bill.id, { amount: 10, method: "cash", paidOn: "2025-03-21" })],
      ["remove payment", () => payments.remove(ctx, f.bill.id)],
    ] as const) await expect(run(), what).rejects.toMatchObject(REFUSED);
    expect(await counts()).toEqual(before);
    expect((await billOf(f.bill.id)).paid).toBe(0);
  });
});

describe("the rent rules", () => {
  it("never takes a payment above what is owed, and only a fully unpaid bill can change its amount", async () => {
    const f = await leaseWithBill("rules-pay");
    expect((await pay(f.bill.id, 20_001)).statusCode).toBe(400);
    expect((await pay(f.bill.id, 0)).statusCode).toBe(422);
    expect((await pay(f.bill.id, 8_000, "agent")).statusCode).toBe(403);
    expect((await pay(f.bill.id, 8_000)).statusCode).toBe(200);
    expect((await call("owner", "PUT", `/rentals/bills/${f.bill.id}`, { amount: 5_000 })).statusCode).toBe(400);   // something is paid
    expect((await billOf(f.bill.id)).amount).toBe(20_000);
    expect((await pay(f.bill.id, 12_001)).statusCode).toBe(400);                                                   // only 12,000 is left
    expect((await pay(f.bill.id, 12_000)).statusCode).toBe(200);
    expect(await billOf(f.bill.id)).toMatchObject({ paid: 20_000 });
    expect((await pay(f.bill.id, 1)).statusCode).toBe(400);
    const future = await leaseWithBill("rules-future");
    expect((await pay(future.bill.id, 100, "owner", "2999-01-01")).statusCode).toBe(400);
  });

  it("holds a deposit and gives it back: not more than held, the unit is freed, and it is never income", async () => {
    const f = await leaseWithBill("rules-deposit");
    const profit = async () => (await call("owner", "GET", "/expenses/profit?from=2025-01&to=2025-12")).json().data.totals;
    const before = await profit();
    expect((await call("owner", "POST", `/rentals/leases/${f.lease}/end`, { endedOn: "2025-06-30", depositReturned: 40_001 })).statusCode).toBe(400);
    expect((await call("owner", "POST", `/rentals/leases/${f.lease}/end`, { endedOn: "2025-06-30", depositReturned: 35_000, depositNote: "Broken window" })).statusCode).toBe(200);
    expect(await app.db!.rentLease.findUniqueOrThrow({ where: { id: f.lease } })).toMatchObject({ status: "ended", depositReturned: 35_000 });
    expect((await app.db!.rentUnit.findUniqueOrThrow({ where: { id: f.unit } })).status).toBe("vacant");
    expect((await call("owner", "POST", `/rentals/leases/${f.lease}/end`, { endedOn: "2025-07-01" })).statusCode).toBe(400);   // already ended
    expect(await profit()).toEqual(before);                                                                                     // a deposit is held and returned, never income
    expect((await events("rentals.lease.ended")).at(-1)?.payload).toMatchObject({ leaseId: f.lease, endedOn: "2025-06-30", depositReturnedPaisa: 3_500_000 });
  });

  it("owner statement = collected - fee - repairs, and saving it puts only the fee in profit", async () => {
    const f = await leaseWithBill("rules-stmt", "2024-09", { start: "2024-01-01", end: "2024-12-31" });
    expect((await pay(f.bill.id, 20_000, "owner", "2024-09-20")).statusCode).toBe(200);
    expect((await call("owner", "POST", "/rentals/repairs", { unitId: f.unit, title: "Paint", cost: 3_000, status: "done", doneOn: "2024-09-25" })).statusCode).toBe(200);
    const profit = async () => (await call("owner", "GET", "/expenses/profit?from=2024-09&to=2024-09")).json().data.totals;
    expect((await profit()).direct).toBe(0);                                                                // rent is the owner's money
    const row = (await call("owner", "GET", "/rentals/statements?month=2024-09")).json().data.rows.find((r: { ownerId: string }) => r.ownerId === f.owner);
    expect(row).toMatchObject({ collected: 20_000, fee: 1_600, repairs: 3_000, payable: 15_400, saved: null });
    expect((await call("accountant", "POST", "/rentals/statements", { ownerId: f.owner, month: "2024-09" })).statusCode).toBe(200);
    expect(await profit()).toMatchObject({ direct: 1_600 });
    const saved = (await call("owner", "GET", "/rentals/statements?month=2024-09")).json().data.rows.find((r: { ownerId: string }) => r.ownerId === f.owner).saved;
    expect(saved).toMatchObject({ fee: 1_600, current: true });
    expect((await call("owner", "DELETE", `/rentals/statements/${saved.id}?version=${saved.version + 5}`)).statusCode).toBe(409);
    expect((await call("owner", "DELETE", `/rentals/statements/${saved.id}`)).statusCode).toBe(200);
    expect((await profit()).direct).toBe(0);
    expect((await audits("rental.statement_removed")).length).toBeGreaterThan(0);
  });

  it("counts an online payment only when confirmed, once, and never above what is owed; leaves Sheetal's to Sheetal", async () => {
    const f = await leaseWithBill("rules-online");
    const db = app.db!;
    const mk = (amount: number, collectedBy: string) => db.rentPayment.create({ data: { tenantId: ids.agency!, branchId: f.bill.branchId, billId: f.bill.id, amount, method: "esewa", paidOn: new Date("2025-03-10"), ref: "ES-1", status: "pending", source: "online", collectedBy } });
    const own = await mk(5_000, "business"), sheetal = await mk(5_000, "sheetal"), tooMuch = await mk(25_000, "business");
    expect((await billOf(f.bill.id)).paid).toBe(0);                                                          // waiting payments count for nothing
    expect((await call("owner", "POST", `/rentals/payments/${sheetal.id}/confirm`)).statusCode).toBe(403);
    expect((await call("agent", "POST", `/rentals/payments/${own.id}/confirm`)).statusCode).toBe(403);
    expect((await call("owner", "POST", `/rentals/payments/${tooMuch.id}/confirm`)).statusCode).toBe(400);   // more than is owed
    expect((await billOf(f.bill.id)).paid).toBe(0);
    expect((await call("owner", "POST", `/rentals/payments/${own.id}/confirm`)).statusCode).toBe(200);
    expect((await call("owner", "POST", `/rentals/payments/${own.id}/confirm`)).statusCode).toBe(400);       // not twice
    expect((await billOf(f.bill.id)).paid).toBe(5_000);
    expect((await audits("rental.payment_confirmed")).at(-1)?.target).toMatch(/Rs\. 5000 online$/);
    expect((await events("rentals.payment.confirmed")).at(-1)?.payload).toMatchObject({ paymentId: own.id, amountPaisa: 500_000 });
    expect((await call("owner", "POST", `/rentals/payments/${tooMuch.id}/reject`, { note: "x" })).statusCode).toBe(422);   // a reason is needed
    expect((await call("owner", "POST", `/rentals/payments/${tooMuch.id}/reject`, { note: "Not seen in the bank" })).statusCode).toBe(200);
    expect((await call("owner", "POST", `/rentals/payments/${sheetal.id}/reject`, { note: "Not seen" })).statusCode).toBe(403);
    expect((await call("owner", "DELETE", `/rentals/payments/${sheetal.id}`)).statusCode).toBe(400);
    expect((await billOf(f.bill.id)).paid).toBe(5_000);
  });

  it("adds a late fee once, and not again after it is waived", async () => {
    const f = await leaseWithBill("rules-late");
    const db = app.db!;
    // With the app's events (as the job runs it), so the late fee writes its event; without them the old stand-alone call adds no event.
    expect(await runRentBills(db, { today: "2025-03-20", tenantId: ids.agency, events: billEventsOf(app) })).toMatchObject({ lateFees: expect.any(Number) });
    expect((await billOf(f.bill.id)).lateFee).toBe(400);
    expect(await runRentBills(db, { today: "2025-03-25", tenantId: ids.agency })).toMatchObject({ lateFees: 0 });
    expect((await billOf(f.bill.id)).lateFee).toBe(400);
    expect((await events("rentals.bill.late_fee_added")).filter((e) => (e.payload as { billId: string }).billId === f.bill.id)).toHaveLength(1);
    expect((await call("owner", "POST", `/rentals/bills/${f.bill.id}/waive`)).statusCode).toBe(200);
    expect((await audits("rental.late_fee_waived")).at(-1)?.target).toMatch(/Rs\. 400$/);
    await runRentBills(db, { today: "2025-04-30", tenantId: ids.agency });
    expect(await billOf(f.bill.id)).toMatchObject({ lateFee: 0, lateWaived: true });
    expect((await call("owner", "POST", `/rentals/bills/${f.bill.id}/waive`)).statusCode).toBe(400);   // nothing left to waive
  });

  it("keeps one bill per lease and month, and does not delete an owner who has units", async () => {
    const f = await leaseWithBill("rules-once");
    expect((await call("owner", "POST", `/rentals/leases/${f.lease}/bills`, { month: "2025-03" })).statusCode).toBe(400);
    expect(await app.db!.rentBill.count({ where: { leaseId: f.lease, month: "2025-03" } })).toBe(1);
    expect((await call("owner", "DELETE", `/rentals/owners/${f.owner}`)).statusCode).toBe(400);
    expect((await call("owner", "DELETE", `/rentals/units/${f.unit}`)).statusCode).toBe(400);   // has a lease
  });
});

describe("the monthly bill job", () => {
  it("is in the registry under rentals.bills, makes each bill once however often it runs, and tells the world once", async () => {
    const db = app.db!;
    const owner = (await addOwner({ name: "Job owner" })).json().data.id as string;
    const unit = await addUnit(owner, "Flat job");
    const month = nepalDay().slice(0, 7);
    const lease = (await call("owner", "POST", "/rentals/leases", { ...LEASE, unitId: unit, start: `${month}-01`, end: "2099-12-31", renter: "Job renter" })).json().data.id as string;
    const spec = rentJob(app);
    expect(spec.id).toBe("rentals.bills");
    await spec.run();
    await spec.run();
    const bills = await db.rentBill.findMany({ where: { leaseId: lease } });
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ month, amount: 20_000, tenantId: ids.agency });
    const made = (await events("rentals.bill.created")).filter((e) => (e.payload as { billId: string }).billId === bills[0]!.id);
    expect(made).toHaveLength(1);
    expect(made[0]!.payload).toMatchObject({ leaseId: lease, month, amountPaisa: 2_000_000 });
  });
});

describe("the page answer", () => {
  it("is the old shape, with a version and can on the rows the screens may use later", async () => {
    const got = (await call("owner", "GET", "/rentals")).json();
    expect(Object.keys(got)).toEqual(["data"]);
    for (const k of ["owners", "units", "leases", "bills", "repairs", "pending"]) expect(Array.isArray(got.data[k]), k).toBe(true);
    expect(got.data.owners[0]).toHaveProperty("version");
  });
});
