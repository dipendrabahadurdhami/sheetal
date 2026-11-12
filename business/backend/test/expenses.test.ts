import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { generateDueExpenses } from "@sheetal/app-expenses/backend/recurring";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-expenses-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object, branch?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency!, ...(branch ? { "x-branch": branch } : {}) } });
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const spend = (over: object = {}, who = "owner") => call(who, "POST", "/expenses", { date: "2026-10-10", category: "rent", amount: 20_000, method: "bank", branchId: ids.head, ...over });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, biz_invoices, doc_counters, expenses, recurring_expenses, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "accountant", "agent", "pokhara"]) {
    const u = await db.user.create({ data: { email: `${k}@everest.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  ids.pokhara_branch = (await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.accountant!, roleId: (await role("accountant")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.pokhara!, roleId: (await role("accountant")).id, status: "active", scopes: ["Pokhara"] } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("who can use expenses", () => {
  it("lets the owner and the accountant in, and keeps the agent out", async () => {
    expect((await call("agent", "GET", "/expenses")).statusCode).toBe(403);
    expect((await spend({}, "agent")).statusCode).toBe(403);
    expect((await call("accountant", "GET", "/expenses")).statusCode).toBe(200);
    expect((await spend({ amount: 1_000 }, "accountant")).statusCode).toBe(200);
  });

  it("limits branch-limited people to their branches", async () => {
    expect((await spend({ branchId: ids.pokhara_branch, amount: 5_000, category: "utilities" })).statusCode).toBe(200);
    const mine = (await call("pokhara", "GET", "/expenses")).json().data.rows;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r: { branch: string }) => r.branch === "Pokhara")).toBe(true);
    expect((await spend({ branchId: ids.head }, "pokhara")).statusCode).toBe(403);
  });
});

describe("adding expenses", () => {
  it("checks the input: 422 for a bad form, 400 for a rule", async () => {
    expect((await spend({ date: "soon" })).statusCode).toBe(422);
    expect((await spend({ amount: 0 })).statusCode).toBe(422);
    expect((await spend({ amount: 10.5 })).statusCode).toBe(422);
    expect((await spend({ method: "gold" })).statusCode).toBe(422);
    expect((await spend({ category: "yachts" })).statusCode).toBe(400);
    expect((await spend({ category: "other" })).statusCode).toBe(400);
    expect((await spend({ category: "other", note: "Office plants" })).statusCode).toBe(200);
  });

  it("uses the category list staff saved in the admin option lists", async () => {
    const cats = (await call("owner", "GET", "/expenses")).json().data.categories.map((c: { id: string }) => c.id);
    expect(cats).toEqual(["salaries", "rent", "utilities", "repairs", "marketing", "supplies", "travel", "commissions", "taxes", "other"]);
    await app.db!.appSetting.create({ data: { key: "catalog", value: { lists: { expenseCategories: [{ id: "security", en: "Security", ne: "सुरक्षा" }, { id: "other", en: "Other", ne: "अन्य" }] } } } });
    expect((await spend({ category: "security" })).statusCode).toBe(200);
    expect((await spend({ category: "rent" })).statusCode).toBe(400);
    await app.db!.appSetting.delete({ where: { key: "catalog" } });
  });

  it("keeps a receipt private: a photo or PDF, nothing else", async () => {
    const id = (await spend({ amount: 7_777 })).json().data.id;
    expect((await call("owner", "POST", `/expenses/${id}/receipt`, { data: Buffer.from("not a picture at all").toString("base64") })).statusCode).toBe(400);
    expect((await call("owner", "POST", `/expenses/${id}/receipt`, { data: PNG })).statusCode).toBe(200);
    expect((await call("owner", "GET", "/expenses")).json().data.rows.find((r: { id: string }) => r.id === id).hasReceipt).toBe(true);
    const got = (await call("owner", "GET", `/expenses/${id}/receipt`)).json().data;
    expect(got.type).toBe("image/png");
    expect(got.data).toBe(PNG);
    expect((await call("agent", "GET", `/expenses/${id}/receipt`)).statusCode).toBe(403);
    expect((await call("pokhara", "GET", `/expenses/${id}/receipt`)).statusCode).toBe(404); // another branch
    expect((await call("owner", "DELETE", `/expenses/${id}/receipt`)).statusCode).toBe(200);
    expect((await call("owner", "GET", `/expenses/${id}/receipt`)).statusCode).toBe(404);
  });

  it("changes and deletes a normal expense", async () => {
    const e = (await spend({ amount: 3_000, category: "supplies" })).json().data;
    expect((await call("owner", "PUT", `/expenses/${e.id}`, { date: "2026-10-11", category: "supplies", amount: 3_500, method: "cash" })).json().data.amount).toBe(3_500);
    expect((await call("owner", "DELETE", `/expenses/${e.id}`)).statusCode).toBe(200);
    expect((await call("owner", "DELETE", `/expenses/${e.id}`)).statusCode).toBe(404);
  });
});

describe("recurring expenses", () => {
  let rid = "";
  it("adds a draft once a month, however often the job runs", async () => {
    const r = await call("owner", "POST", "/expenses/recurring", { category: "rent", amount: 40_000, dayOfMonth: 1, method: "bank", vendor: "Landlord", branchId: ids.head });
    expect(r.statusCode).toBe(200);
    rid = r.json().data.id;
    const month = nepalDay().slice(0, 7);
    // Creating it already made this month's draft (day 1 has come); running the job again adds nothing.
    expect(await generateDueExpenses(app.db!, { today: nepalDay(), tenantId: ids.agency })).toBe(0);
    expect(await generateDueExpenses(app.db!, { today: nepalDay() })).toBe(0);
    const drafts = (await call("owner", "GET", "/expenses?status=draft")).json().data.rows;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: "draft", amount: 40_000, forMonth: month, recurringId: rid });
    expect(await app.db!.expense.count({ where: { recurringId: rid } })).toBe(1);
  });

  it("counts only confirmed expenses, and lets the amount change when confirming", async () => {
    const d = (await call("owner", "GET", "/expenses?status=draft")).json().data.rows[0];
    const month = d.forMonth;
    const profit = async () => (await call("owner", "GET", `/expenses/profit?from=${month}&to=${month}`)).json().data.totals.expenses;
    expect(await profit()).toBe(0);
    expect((await call("agent", "POST", `/expenses/${d.id}/confirm`, {})).statusCode).toBe(403);
    const ok = await call("owner", "POST", `/expenses/${d.id}/confirm`, { amount: 42_500 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ status: "confirmed", amount: 42_500, method: "bank" });
    expect(await profit()).toBe(42_500);
    expect((await call("owner", "POST", `/expenses/${d.id}/confirm`, {})).statusCode).toBe(400); // only once
  });

  it("keeps a skipped draft out of the way, and never makes it again", async () => {
    const future = "2099-03-10";
    expect(await generateDueExpenses(app.db!, { today: future, tenantId: ids.agency })).toBe(1);
    const d = await app.db!.expense.findFirstOrThrow({ where: { recurringId: rid, forMonth: "2099-03" } });
    expect((await call("owner", "DELETE", `/expenses/${d.id}`)).json().message).toMatch(/skipped/);
    expect(await app.db!.expense.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "skipped" });
    expect(await generateDueExpenses(app.db!, { today: future, tenantId: ids.agency })).toBe(0);
    expect(await app.db!.expense.count({ where: { recurringId: rid, forMonth: "2099-03" } })).toBe(1);
  });

  it("makes nothing while paused, and again after it is resumed; a stopped one is final", async () => {
    expect((await call("owner", "POST", `/expenses/recurring/${rid}/pause`)).statusCode).toBe(200);
    expect(await generateDueExpenses(app.db!, { today: "2099-04-10" })).toBe(0);
    expect((await call("owner", "POST", `/expenses/recurring/${rid}/pause`)).statusCode).toBe(400);
    expect((await call("owner", "POST", `/expenses/recurring/${rid}/resume`)).statusCode).toBe(200);
    expect(await generateDueExpenses(app.db!, { today: "2099-04-10" })).toBe(1);
    expect((await call("owner", "POST", `/expenses/recurring/${rid}/stop`)).statusCode).toBe(200);
    expect(await generateDueExpenses(app.db!, { today: "2099-05-10" })).toBe(0);
    expect((await call("owner", "POST", `/expenses/recurring/${rid}/resume`)).statusCode).toBe(400);
    expect((await call("owner", "PUT", `/expenses/recurring/${rid}`, { category: "rent", amount: 1, dayOfMonth: 1, method: "cash" })).statusCode).toBe(400);
    expect((await call("owner", "GET", "/expenses/recurring")).json().data[0].status).toBe("stopped"); // kept as history
  });

  it("checks the day of the month", async () => {
    expect((await call("owner", "POST", "/expenses/recurring", { category: "rent", amount: 100, dayOfMonth: 31, method: "cash", branchId: ids.head })).statusCode).toBe(422);
  });
});

describe("profit", () => {
  // A 6,500 invoice plus 13% VAT = 7,345, paid in two parts in two months.
  it("counts money received directly without VAT, by the month it was paid, and never counts Sheetal's money twice", async () => {
    const db = app.db!;
    await db.$executeRawUnsafe(`TRUNCATE biz_invoices, doc_counters, payouts, payout_items, expenses, recurring_expenses RESTART IDENTITY CASCADE`);
    const inv = (await call("owner", "POST", "/invoices", { to: "Sita", date: "2026-10-05", due: "2026-10-15", vatPct: 13, lines: [{ what: "Consultation", qty: 2, rate: 3000 }, { what: "Service fee", qty: 1, rate: 500 }], branchId: ids.head, send: true })).json().data;
    expect(inv.t.total).toBe(7345);
    expect((await call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 3000, method: "cash", at: "2026-10-20" })).statusCode).toBe(200);
    expect((await call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 4345, method: "bank", at: "2026-11-02" })).statusCode).toBe(200);
    // Money Sheetal collected: its receipt has the "sheetal" method, and the payout covers it.
    await db.bizReceipt.create({ data: { tenantId: ids.agency!, invoiceId: inv.id, no: "RC-TEST-0001", amount: 1000, method: "sheetal", paidOn: new Date("2026-10-25T00:00:00Z") } });
    // A payout (net 9,000 after Rs. 1,000 commission), paid in October for the head office.
    await db.payout.create({ data: { tenantId: ids.agency!, branchId: ids.head!, kind: "batch", status: "paid", gross: 10_000, fee: 1_000, net: 9_000, scheduledOn: new Date("2026-10-24T00:00:00Z"), paidOn: new Date("2026-10-24T00:00:00Z") } });
    await db.payout.create({ data: { tenantId: ids.agency!, branchId: ids.head!, kind: "batch", status: "pending", gross: 5_000, fee: 500, net: 4_500, scheduledOn: new Date("2026-10-30T00:00:00Z") } }); // not paid yet: not counted
    await spend({ date: "2026-10-31", amount: 2_000, category: "utilities" });
    await spend({ date: "2026-11-01", amount: 6_000, category: "repairs" });

    const p = (await call("owner", "GET", "/expenses/profit?from=2026-10&to=2026-11")).json().data;
    const oct = p.rows.find((r: { month: string; branch: string }) => r.month === "2026-10" && r.branch === "Head office");
    const nov = p.rows.find((r: { month: string; branch: string }) => r.month === "2026-11" && r.branch === "Head office");
    // 3,000 paid in October: 2,655 before VAT and 345 VAT. The 1,000 "sheetal" payment is left out.
    expect(oct).toMatchObject({ direct: 2_655, vat: 345, payouts: 9_000, commission: 1_000, expenses: 2_000, profit: 2_655 + 9_000 - 2_000 });
    // 4,345 paid in November: 3,845 before VAT and 500 VAT.
    expect(nov).toMatchObject({ direct: 3_845, vat: 500, payouts: 0, commission: 0, expenses: 6_000, profit: 3_845 - 6_000 });
    expect(p.totals).toMatchObject({ direct: 6_500, vat: 845, payouts: 9_000, commission: 1_000, expenses: 8_000 });
    expect(p.totals.profit).toBe(6_500 + 9_000 - 8_000);
  });

  it("limits branch-limited people to their branches, and checks the months", async () => {
    const p = (await call("pokhara", "GET", "/expenses/profit?from=2026-10&to=2026-11")).json().data;
    expect(p.rows.every((r: { branch: string }) => r.branch === "Pokhara")).toBe(true);
    expect(p.totals.payouts).toBe(0);
    expect((await call("agent", "GET", "/expenses/profit")).statusCode).toBe(403);
    expect((await call("owner", "GET", "/expenses/profit?from=2026-11&to=2026-10")).statusCode).toBe(400);
    expect((await call("owner", "GET", "/expenses/profit?from=soon")).statusCode).toBe(422);
    expect((await call("owner", "GET", "/expenses/profit")).statusCode).toBe(200);
  });
});
