// Tests for Expenses on the kernel (P1-BE-5): what the move to apps/expenses/backend added. expenses.test.ts (the 13 old tests) is NOT repeated here.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by backend-core/test/setup-db.ts): npm run test -w @sheetal/business-api
// How it works: a real business API with a few people (owner, accountant, a Pokhara-only accountant, an agent, two custom roles) in "Everest Realty" and one more
// business; calls go through HTTP (app.inject), the database is read straight afterwards to check what was really written.
// Rules: covers isolation (other business, other branch), version conflict (409), soft delete, paisa, the audit/event lines, the event in the same transaction
// (and gone on rollback), the recurring job, and the new permission names. Money is whole rupees in the API, paisa in the table.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { ExpenseRepository } from "@sheetal/app-expenses/backend/expense.repository";
import { ExpenseService, RecurringExpenseService } from "@sheetal/app-expenses/backend/expense.service";
import { draftEventsOf } from "@sheetal/app-expenses/backend/host";
import { generateDueExpenses } from "@sheetal/app-expenses/backend/recurring";
import { expenseJob } from "@sheetal/app-expenses/backend";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-expenses-kernel-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object, o: { branch?: string; tenant?: string } = {}) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": o.tenant ?? ids.agency!, ...(o.branch ? { "x-branch": o.branch } : {}) } });
const spend = (over: object = {}, who = "owner", o: { branch?: string; tenant?: string } = {}) =>
  call(who, "POST", "/expenses", { date: "2026-10-10", category: "rent", amount: 1_200, method: "bank", branchId: ids.head, ...over }, o);
const row = (id: string) => app.db!.expense.findUniqueOrThrow({ where: { id } });
const audits = (action: string) => app.db!.auditLog.findMany({ where: { tenantId: ids.agency, action }, orderBy: { createdAt: "asc" } });
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.agency, name }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, event_outbox, biz_invoices, doc_counters, expenses, recurring_expenses, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "accountant", "agent", "pokhara", "reader", "oldview", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel.test`, userName: k, emailVerifiedAt: new Date() } });
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
  await join(ids.reader!, await custom("reader_new", ["expenses.expense.read:branch"]));       // only the NEW name, read only
  await join(ids.oldview!, await custom("viewer_old", ["expenses.expense.read", "expenses.recurring.read", "expenses.profit.read"]));                     // what the old name expenses.view stood for
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("isolation", () => {
  // The kernel helper: another business, deleted rows, other branches, "own" scope, compare-and-set, all on the real expenses table.
  const db = createDb(inject("databaseUrl"))!;
  testRepositoryIsolation("ExpenseRepository", {
    db, repo: new ExpenseRepository(), model: "expense",
    row: ({ tenantId, branchId, userId, n }) => ({ tenantId, branchId, spentOn: new Date("2026-11-01"), category: "other", amount: 100 + n, amountPaisa: BigInt(100 + n) * 100n, note: `iso ${userId}` }),
    createData: ({ branchId }) => ({ spentOn: new Date("2026-11-02"), category: "other", amount: 50, amountPaisa: 5000n, branchId }),
    update: { data: { note: "changed" }, changedField: "note" },
    transition: { from: { status: "confirmed" }, to: { status: "skipped" } },
  });

  it("does not find, change, confirm, delete or open the receipt of another business's expense", async () => {
    const theirs = (await spend({ branchId: ids.otherHead }, "other", { tenant: ids.second })).json().data;
    expect(theirs.id).toBeTruthy();
    for (const [method, url, body] of [
      ["PUT", `/expenses/${theirs.id}`, { date: "2026-10-11", category: "rent", amount: 5, method: "cash" }],
      ["POST", `/expenses/${theirs.id}/confirm`, {}],
      ["DELETE", `/expenses/${theirs.id}`, undefined],
      ["GET", `/expenses/${theirs.id}/receipt`, undefined],
    ] as const) expect((await call("owner", method, url, body)).statusCode, `${method} ${url}`).toBe(404);
    expect((await call("owner", "GET", "/expenses")).json().data.rows.some((r: { id: string }) => r.id === theirs.id)).toBe(false);
    expect((await call("owner", "GET", "/expenses", undefined, { tenant: ids.second })).statusCode).toBe(403);   // not a member of that business
    expect((await row(theirs.id)).deletedAt).toBeNull();                                                          // and nothing happened to it
  });

  it("does not find another branch's expense for a branch-limited person (and says the same as for a missing one)", async () => {
    const head = (await spend({ branchId: ids.head, amount: 4_321 })).json().data;
    for (const [method, url, body] of [
      ["PUT", `/expenses/${head.id}`, { date: "2026-10-11", category: "rent", amount: 5, method: "cash" }],
      ["DELETE", `/expenses/${head.id}`, undefined],
      ["POST", `/expenses/${head.id}/receipt`, { data: "A".repeat(32) }],
    ] as const) {
      const got = await call("pokhara", method, url, body);
      expect(got.statusCode, `${method} ${url}`).toBe(404);
      expect(got.json().message).toBe("Expense not found.");
    }
    expect((await call("pokhara", "GET", "/expenses")).json().data.rows.some((r: { id: string }) => r.id === head.id)).toBe(false);
    expect((await row(head.id)).amount).toBe(4_321);
  });

  it("lets the owner's top-bar branch narrow the list, as the page always did", async () => {
    await spend({ branchId: ids.pk, amount: 2_468 });
    const all = (await call("owner", "GET", "/expenses")).json().data.rows;
    expect(new Set(all.map((r: { branch: string }) => r.branch))).toEqual(new Set(["Head office", "Pokhara"]));
    const only = (await call("owner", "GET", "/expenses", undefined, { branch: ids.pk })).json().data.rows;
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((r: { branch: string }) => r.branch === "Pokhara")).toBe(true);
  });
});

describe("permission names", () => {
  it("a role with only the NEW read name reads expenses, and nothing more", async () => {
    expect((await call("reader", "GET", "/expenses")).statusCode).toBe(200);
    expect((await call("reader", "GET", "/expenses")).json().data.canManage).toBe(false);
    const add = await spend({}, "reader");
    expect(add.statusCode).toBe(403);
    expect(add.json().message).toBe("Your role can't add or change expenses.");
    expect((await call("reader", "GET", "/expenses/profit")).statusCode).toBe(403);
    expect((await call("reader", "GET", "/expenses/recurring")).statusCode).toBe(403);
  });
  it("a role with only the OLD expenses.view still reads expenses, recurring and profit, and still cannot write", async () => {
    expect((await call("oldview", "GET", "/expenses")).statusCode).toBe(200);
    expect((await call("oldview", "GET", "/expenses/recurring")).statusCode).toBe(200);
    expect((await call("oldview", "GET", "/expenses/profit")).statusCode).toBe(200);
    expect((await spend({}, "oldview")).statusCode).toBe(403);
    expect((await call("oldview", "POST", `/expenses/recurring`, { category: "rent", amount: 1, dayOfMonth: 1, method: "cash", branchId: ids.head })).statusCode).toBe(403);
  });
  it("a stored old role (accountant: expenses.manage) can do everything it could", async () => {
    const e = (await spend({ amount: 900 }, "accountant")).json().data;
    expect((await call("accountant", "PUT", `/expenses/${e.id}`, { date: "2026-10-10", category: "rent", amount: 950, method: "cash" })).statusCode).toBe(200);
    expect((await call("accountant", "DELETE", `/expenses/${e.id}`)).statusCode).toBe(200);
    expect((await call("accountant", "GET", "/expenses/profit")).statusCode).toBe(200);
  });
});

describe("audit lines and events", () => {
  it("writes the old audit action strings and target text, and the new events, for add / change / delete", async () => {
    const e = (await spend({ amount: 1_200, category: "supplies" })).json().data;
    const no = e.no as string;
    expect((await audits("expense.added")).at(-1)?.target).toBe(`${no} Rs. 1200`);
    expect((await events("expenses.expense.confirmed")).at(-1)?.payload).toMatchObject({ expenseId: e.id, amountPaisa: 120_000, category: "supplies", spentOn: "2026-10-10", method: "bank" });

    expect((await call("owner", "PUT", `/expenses/${e.id}`, { date: "2026-10-10", category: "supplies", amount: 1_500, method: "bank" })).statusCode).toBe(200);
    expect((await audits("expense.changed")).at(-1)?.target).toBe(`${no} Rs. 1200 → 1500`);
    expect((await events("expenses.expense.updated")).at(-1)?.payload).toMatchObject({ expenseId: e.id, amountPaisa: 150_000, previousAmountPaisa: 120_000 });

    expect((await call("owner", "DELETE", `/expenses/${e.id}`)).json().message).toBe(`${no} deleted.`);
    expect((await audits("expense.deleted")).at(-1)?.target).toBe(`${no} Rs. 1500`);
    expect((await events("expenses.expense.deleted")).at(-1)?.payload).toMatchObject({ expenseId: e.id, amountPaisa: 150_000 });
  });

  it("writes expense.confirmed / expense.skipped and recurring audit lines like before", async () => {
    await app.db!.$executeRawUnsafe(`TRUNCATE recurring_expenses CASCADE`);
    const r = (await call("owner", "POST", "/expenses/recurring", { category: "rent", amount: 40_000, dayOfMonth: 1, method: "bank", branchId: ids.head })).json().data;
    expect((await audits("expense.recurring_added")).at(-1)?.target).toBe("rent Rs. 40000 on day 1");
    expect((await call("owner", "PUT", `/expenses/recurring/${r.id}`, { category: "rent", amount: 41_000, dayOfMonth: 2, method: "bank" })).statusCode).toBe(200);
    expect((await audits("expense.recurring_changed")).at(-1)?.target).toBe("rent Rs. 40000 → 41000");
    const draft = await app.db!.expense.findFirstOrThrow({ where: { recurringId: r.id } });
    const done = (await call("owner", "POST", `/expenses/${draft.id}/confirm`, { amount: 42_000 })).json();
    expect(done.message).toBe(`${done.data.no} confirmed.`);
    expect((await audits("expense.confirmed")).at(-1)?.target).toBe(`${done.data.no} Rs. 42000`);
    expect((await events("expenses.expense.confirmed")).at(-1)?.payload).toMatchObject({ expenseId: draft.id, amountPaisa: 4_200_000 });
    // the same for a skipped draft
    expect(await generateDueExpenses(app.db!, { today: "2097-06-10", tenantId: ids.agency, events: draftEventsOf(app) })).toBe(1);
    const next = await app.db!.expense.findFirstOrThrow({ where: { recurringId: r.id, forMonth: "2097-06" } });
    const nextNo = `EX-${String(next.seq).padStart(4, "0")}`;
    expect((await call("owner", "DELETE", `/expenses/${next.id}`)).json().message).toBe(`${nextNo} skipped.`);
    expect((await audits("expense.skipped")).at(-1)?.target).toBe(`${nextNo} Rs. 41000`);
    expect((await events("expenses.expense.skipped")).at(-1)?.payload).toMatchObject({ expenseId: next.id, recurringId: r.id, forMonth: "2097-06" });
    expect((await call("owner", "POST", `/expenses/recurring/${r.id}/pause`)).statusCode).toBe(200);
    expect((await audits("expense.recurring_paused")).at(-1)?.target).toBe("rent Rs. 41000");
  });
});

describe("version conflict", () => {
  it("answers 409 version_conflict for a stale version, saves without one, and counts versions up", async () => {
    const e = (await spend({ amount: 700 })).json().data;
    expect(e.version).toBe(1);
    const put = (version: number | undefined, amount: number) => call("owner", "PUT", `/expenses/${e.id}`, { date: "2026-10-10", category: "rent", amount, method: "bank", ...(version === undefined ? {} : { version }) });
    const first = await put(1, 710);
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ amount: 710, version: 2 });
    const stale = await put(1, 720);                       // someone saved version 2 meanwhile
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("version_conflict");
    expect((await row(e.id)).amount).toBe(710);            // the stale save changed nothing
    const fresh = await put(2, 730);
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().data.version).toBe(3);
    const none = await put(undefined, 740);                // the old page sends no version: last write wins, as today
    expect(none.statusCode).toBe(200);
    expect(none.json().data).toMatchObject({ amount: 740, version: 4 });
    expect((await call("owner", "DELETE", `/expenses/${e.id}?version=1`)).statusCode).toBe(409);
    expect((await row(e.id)).deletedAt).toBeNull();
    expect((await call("owner", "DELETE", `/expenses/${e.id}?version=4`)).statusCode).toBe(200);
  });

  it("refuses a stale version when confirming a draft or pausing a recurring expense", async () => {
    await app.db!.$executeRawUnsafe(`TRUNCATE recurring_expenses CASCADE`);
    const r = (await call("owner", "POST", "/expenses/recurring", { category: "rent", amount: 100, dayOfMonth: 1, method: "cash", branchId: ids.head })).json().data;
    const draft = await app.db!.expense.findFirstOrThrow({ where: { recurringId: r.id } });
    expect((await call("owner", "POST", `/expenses/${draft.id}/confirm`, { version: draft.version + 1 })).statusCode).toBe(409);
    expect((await row(draft.id)).status).toBe("draft");
    expect((await call("owner", "POST", `/expenses/recurring/${r.id}/pause`, { version: r.version + 5 })).statusCode).toBe(409);
    expect((await call("owner", "POST", `/expenses/recurring/${r.id}/pause`, { version: r.version })).statusCode).toBe(200);
    expect((await call("owner", "POST", `/expenses/${draft.id}/confirm`, { version: draft.version })).statusCode).toBe(200);
  });
});

describe("soft delete", () => {
  it("keeps the row but hides it from the list and from profit", async () => {
    await app.db!.$executeRawUnsafe(`TRUNCATE expenses, recurring_expenses CASCADE`);
    const keep = (await spend({ date: "2026-09-05", amount: 1_000 })).json().data;
    const gone = (await spend({ date: "2026-09-06", amount: 2_500 })).json().data;
    const profit = async () => (await call("owner", "GET", "/expenses/profit?from=2026-09&to=2026-09")).json().data.totals.expenses;
    expect(await profit()).toBe(3_500);
    expect((await call("owner", "DELETE", `/expenses/${gone.id}`)).statusCode).toBe(200);
    const kept = await row(gone.id);                       // still there …
    expect(kept.deletedAt).toBeInstanceOf(Date);
    expect(kept.deletedBy).toBe(ids.owner);
    expect(kept.version).toBe(2);
    const list = (await call("owner", "GET", "/expenses?month=2026-09")).json().data.rows.map((r: { id: string }) => r.id);
    expect(list).toEqual([keep.id]);                       // … but not listed
    expect(await profit()).toBe(1_000);                    // … and not in profit (the page's CSV is made from these same rows)
    expect((await call("owner", "GET", `/expenses/${gone.id}/receipt`)).statusCode).toBe(404);
    expect((await call("owner", "PUT", `/expenses/${gone.id}`, { date: "2026-09-06", category: "rent", amount: 1, method: "cash" })).statusCode).toBe(404);
    expect((await call("owner", "DELETE", `/expenses/${gone.id}`)).statusCode).toBe(404);
  });

  it("counts a draft in the draft badge only while it is a draft; skipped and deleted are out", async () => {
    await app.db!.$executeRawUnsafe(`TRUNCATE expenses, recurring_expenses CASCADE`);
    await call("owner", "POST", "/expenses/recurring", { category: "rent", amount: 100, dayOfMonth: 1, method: "cash", branchId: ids.head });
    const d = (await call("owner", "GET", "/expenses?status=draft")).json().data;
    expect(d.drafts).toBe(1);
    expect((await call("owner", "DELETE", `/expenses/${d.rows[0].id}`)).json().message).toMatch(/skipped/);
    expect((await call("owner", "GET", "/expenses")).json().data.drafts).toBe(0);
  });
});

describe("paisa", () => {
  it("writes amount and amount_paisa together on create, change, confirm and the recurring draft; the API still shows whole rupees", async () => {
    await app.db!.$executeRawUnsafe(`TRUNCATE expenses, recurring_expenses CASCADE`);
    const made = await spend({ amount: 12_345 });
    expect(made.json().data.amount).toBe(12_345);
    const e = made.json().data;
    expect(await row(e.id)).toMatchObject({ amount: 12_345, amountPaisa: 1_234_500n });
    await call("owner", "PUT", `/expenses/${e.id}`, { date: "2026-10-10", category: "rent", amount: 777, method: "cash" });
    expect(await row(e.id)).toMatchObject({ amount: 777, amountPaisa: 77_700n });

    const r = (await call("owner", "POST", "/expenses/recurring", { category: "rent", amount: 5_000, dayOfMonth: 1, method: "bank", branchId: ids.head })).json().data;
    expect(await app.db!.recurringExpense.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ amount: 5_000, amountPaisa: 500_000n });
    const draft = await app.db!.expense.findFirstOrThrow({ where: { recurringId: r.id } });
    expect(draft).toMatchObject({ amount: 5_000, amountPaisa: 500_000n });
    await call("owner", "PUT", `/expenses/recurring/${r.id}`, { category: "rent", amount: 6_000, dayOfMonth: 1, method: "bank" });
    expect(await app.db!.recurringExpense.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ amount: 6_000, amountPaisa: 600_000n });
    const ok = await call("owner", "POST", `/expenses/${draft.id}/confirm`, { amount: 5_500 });
    expect(ok.json().data.amount).toBe(5_500);
    expect(await row(draft.id)).toMatchObject({ amount: 5_500, amountPaisa: 550_000n, status: "confirmed" });
  });

  it("reads a row the backfill has not reached (amount_paisa NULL) from its rupees, and profit totals are the same", async () => {
    await app.db!.$executeRawUnsafe(`TRUNCATE expenses, recurring_expenses CASCADE`);
    const e = (await spend({ date: "2026-08-03", amount: 3_000 })).json().data;
    await app.db!.$executeRawUnsafe(`UPDATE expenses SET amount_paisa = NULL WHERE id = '${e.id}'`);
    expect((await call("owner", "GET", "/expenses?month=2026-08")).json().data.rows[0].amount).toBe(3_000);
    expect((await call("owner", "GET", "/expenses/profit?from=2026-08&to=2026-08")).json().data.totals.expenses).toBe(3_000);
    // the resync migration's statement fills it, and is safe to run twice
    for (let i = 0; i < 2; i++) await app.db!.$executeRawUnsafe(`UPDATE "expenses" SET "amount_paisa" = "amount"::BIGINT * 100 WHERE "amount_paisa" IS NULL`);
    expect((await row(e.id)).amountPaisa).toBe(300_000n);
  });
});

describe("the event is written in the same transaction as the change", () => {
  const service = () => new ExpenseService({ bus: app.events!.bus, mediaDir: () => media, generateDue: async () => 0 });
  const context = () => makeTestContext({ db: app.db!, businessId: ids.agency!, branches: [{ id: ids.head! }, { id: ids.pk! }], userId: ids.owner });
  const input = (amount: number) => ({ date: "2026-10-12", category: "rent", amount, method: "cash", branchId: ids.head });
  const traces = async (amount: number) => ({
    expenses: await app.db!.expense.count({ where: { tenantId: ids.agency, amount } }),
    events: (await events("expenses.expense.confirmed")).filter((e) => (e.payload as { amountPaisa: number }).amountPaisa === amount * 100).length,
    audits: (await audits("expense.added")).filter((a) => a.target?.endsWith(`Rs. ${amount}`)).length,
  });

  it("commits the row, the audit line and the event together", async () => {
    const row = await context().transaction((tx) => service().create(tx, input(8_881)));
    expect(row.amountPaisa).toBe(888_100n);
    expect(await traces(8_881)).toEqual({ expenses: 1, events: 1, audits: 1 });
  });

  it("leaves nothing behind when the transaction rolls back", async () => {
    await expect(context().transaction(async (tx) => {
      await service().create(tx, input(7_771));
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await traces(7_771)).toEqual({ expenses: 0, events: 0, audits: 0 });
  });
});

describe("a read-only support session (QA, P1-BE-5 fix 2)", () => {
  // Sheetal support opening the business read-only: the kernel refuses every write before anything else (BE-1 rule, BE-3 order).
  const REFUSED = { statusCode: 403, message: "This is a read-only support session. Changes are not allowed." };
  const deps = () => ({ bus: app.events!.bus, mediaDir: () => media, generateDue: async () => 0 });
  const readOnly = () => ({
    ...makeTestContext({ db: app.db!, businessId: ids.agency!, branches: [{ id: ids.head! }, { id: ids.pk! }], userId: ids.owner }),
    actor: { kind: "staff" as const, staffId: "support-1", name: "Support", role: "support" },
    impersonation: { staffId: "support-1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 15 * 60_000), readOnly: true },
  });

  it("can read, but is refused on add, change, confirm, delete, receipt and every recurring write, and nothing is written", async () => {
    const draft = (await spend({ amount: 3_331 })).json().data;
    const before = { expenses: await app.db!.expense.count(), recurring: await app.db!.recurringExpense.count(), audits: await app.db!.auditLog.count(), events: await app.db!.eventOutbox.count() };
    const e = new ExpenseService(deps()), r = new RecurringExpenseService(deps()), ctx = readOnly();
    await expect(e.get(ctx, draft.id)).resolves.toMatchObject({ id: draft.id });   // reading is fine
    for (const [what, run] of [
      ["add", () => e.create(ctx, { date: "2026-10-12", category: "rent", amount: 10, method: "cash", branchId: ids.head })],
      ["change", () => e.update(ctx, draft.id, { amount: 11 })],
      ["confirm", () => e.confirm(ctx, draft.id, { amount: 12 })],
      ["delete", () => e.discard(ctx, draft.id)],
      ["add receipt", () => e.attachReceipt(ctx, draft.id, { data: Buffer.from("%PDF-1.4").toString("base64") })],
      ["remove receipt", () => e.removeReceipt(ctx, draft.id)],
      ["add recurring", () => r.create(ctx, { category: "rent", amount: 10, dayOfMonth: 1, method: "cash", branchId: ids.head })],
    ] as const) await expect(run(), what).rejects.toMatchObject(REFUSED);
    expect({ expenses: await app.db!.expense.count(), recurring: await app.db!.recurringExpense.count(), audits: await app.db!.auditLog.count(), events: await app.db!.eventOutbox.count() }).toEqual(before);
  });
});

describe("the recurring job", () => {
  it("adds a draft once per month, with its event and paisa, however often it runs", async () => {
    const db = app.db!;
    await db.$executeRawUnsafe(`TRUNCATE expenses, recurring_expenses CASCADE`);
    const month = nepalDay().slice(0, 7);
    // inserted straight into the table, so nothing has made this month's draft yet
    const t = await db.recurringExpense.create({ data: { tenantId: ids.agency!, branchId: ids.head!, category: "rent", amount: 9_000, amountPaisa: 900_000n, method: "bank", dayOfMonth: 1, startMonth: "2020-01", createdBy: ids.owner } });
    const spec = expenseJob(app);
    expect(spec.id).toBe("expenses.recurring");
    await spec.run();
    await spec.run();                                       // the second run adds nothing
    const drafts = await db.expense.findMany({ where: { recurringId: t.id } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: "draft", forMonth: month, amount: 9_000, amountPaisa: 900_000n, tenantId: ids.agency, branchId: ids.head, createdBy: ids.owner });
    const made = (await events("expenses.recurring.draft_created")).filter((e) => (e.payload as { recurringId: string }).recurringId === t.id);
    expect(made).toHaveLength(1);
    expect(made[0]!.payload).toMatchObject({ expenseId: drafts[0]!.id, forMonth: month, branchId: ids.head });
    expect(made[0]!.branchId).toBe(ids.head);
    // it also tells the team
    expect(await db.notification.count({ where: { tenantId: ids.agency, type: "expense" } })).toBeGreaterThan(0);
  });

  it("still adds drafts when called without an event bus (the old call), and a skipped one is never made again", async () => {
    const db = app.db!;
    await db.$executeRawUnsafe(`TRUNCATE expenses, recurring_expenses CASCADE`);
    const t = await db.recurringExpense.create({ data: { tenantId: ids.agency!, branchId: ids.head!, category: "rent", amount: 100, amountPaisa: 10_000n, method: "cash", dayOfMonth: 5, startMonth: "2090-01" } });
    expect(await generateDueExpenses(db, { today: "2090-01-04" })).toBe(0);            // day 5 has not come
    expect(await generateDueExpenses(db, { today: "2090-01-05" })).toBe(1);
    expect(await generateDueExpenses(db, { today: "2090-01-31" })).toBe(0);
    const d = await db.expense.findFirstOrThrow({ where: { recurringId: t.id } });
    expect(d.amountPaisa).toBe(10_000n);
    // no bus given, no event for THIS recurring expense (earlier tests in this file write their own draft events to the same table)
    expect((await db.eventOutbox.findMany({ where: { name: "expenses.recurring.draft_created" } })).filter((e) => (e.payload as { recurringId: string }).recurringId === t.id)).toHaveLength(0);
    await call("owner", "DELETE", `/expenses/${d.id}`);
    expect(await generateDueExpenses(db, { today: "2090-01-31" })).toBe(0);
    expect(await db.expense.count({ where: { recurringId: t.id } })).toBe(1);
  });
});

describe("notifications use the alias layer (QA, P1-BE-5 fix 1)", () => {
  it("a role holding only the NEW confirm permission is told about new recurring drafts", async () => {
    const db = app.db!;
    const confirmer = await db.user.create({ data: { email: "confirmer@kernel.test", userName: "confirmer", emailVerifiedAt: new Date() } });
    const roleId = (await db.role.create({ data: { tenantId: ids.agency!, key: "confirmer_new", name: "confirmer_new", system: false, perms: ["expenses.expense.read:branch", "expenses.expense.confirm:branch"] } })).id;
    await db.membership.create({ data: { tenantId: ids.agency!, userId: confirmer.id, roleId, status: "active" } });
    await db.recurringExpense.create({ data: { tenantId: ids.agency!, branchId: ids.head!, category: "rent", amount: 4_441, amountPaisa: 444_100n, dayOfMonth: 1, method: "bank", startMonth: "2098-01", status: "active" } });
    expect(await generateDueExpenses(db, { today: "2098-01-10", tenantId: ids.agency, events: draftEventsOf(app) })).toBeGreaterThan(0);
    const note = await db.notification.findFirst({ where: { tenantId: ids.agency, userId: confirmer.id, type: "expense" } });
    expect(note?.title).toMatch(/recurring expense/);
  });
});

describe("the list answer", () => {
  it("is the old shape without page/per, and has meta only when a page is asked for", async () => {
    const plain = (await call("owner", "GET", "/expenses")).json();
    expect(Object.keys(plain)).toEqual(["data"]);
    expect(Object.keys(plain.data).sort()).toEqual(["canManage", "categories", "drafts", "methods", "rows"]);
    const paged = (await call("owner", "GET", "/expenses?status=confirmed&per=1")).json();
    expect(paged.meta).toMatchObject({ per_page: 1, current_page: 1 });
    expect(paged.meta.total).toBeGreaterThanOrEqual(paged.data.rows.length);
    expect(paged.data.rows.length).toBeLessThanOrEqual(1);
  });
});
