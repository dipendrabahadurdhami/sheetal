// Expenses, recurring expenses and profit: what a business spent, and what is left of what it received.
// Where it fits: Business → Expenses (LiveExpenses.jsx): the Expenses, Recurring and Profit tabs.
// How it works: an expense belongs to one branch, with a date, category (from the admin option list), amount, vendor,
// note, payment method and an optional receipt (photo or PDF, kept private and opened only through this API). A
// recurring expense is a monthly template: a background job (and the page when it opens) adds this month's draft once
// its day has come; the business confirms it (the amount can be changed first) or skips it. Only confirmed expenses
// count in profit. Profit by month and branch = money received directly (invoice payments without VAT) + payouts
// from Sheetal (their net) − expenses; VAT collected and Sheetal's commission are shown for information (see
// backend-core/src/domain/expenses.ts for the exact rules). A CSV of the profit view is made by the page.
// Rules: expenses.view reads; expenses.manage changes anything; every expense belongs to one branch and people only see
// and change their branches'; "Other" needs a note; a draft made by a recurring expense is never deleted, only
// skipped, so the job can't add it again.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { startJobs, type JobSpec } from "@sheetal/platform/jobs/registry";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { readPrivateFile, savePrivateFile } from "@sheetal/backend-core/lib/files";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { EXPENSE_METHODS, MAX_EXPENSE, expenseCategories, expenseNo, generateDueExpenses, monthSpan, monthsBetween, profitRows } from "@sheetal/backend-core/domain/expenses";
import { branchFor, branchView, inView, workspaceOf, type Workspace } from "../access.js";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.");
const Amount = z.number().int("Use whole rupees.").min(1, "The amount must be more than zero.").max(MAX_EXPENSE);
const Fields = {
  category: z.string().trim().min(1, "Choose a category.").max(60),
  amount: Amount,
  vendor: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(300).nullish(),
  method: z.enum(EXPENSE_METHODS).default("cash"),
  branchId: z.string().max(40).nullish(),
};
const ExpenseBody = z.object({ date: Day, ...Fields });
const RecurringBody = z.object({ ...Fields, dayOfMonth: z.number().int().min(1, "Choose a day from 1 to 28.").max(28, "Choose a day from 1 to 28."), startMonth: Month.optional() });

export async function expenseRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const canView = (ws: Workspace) => { if (!ws.can("expenses.view") && !ws.can("expenses.manage")) throw forbidden("Your role can't see expenses."); };
  const canWrite = (ws: Workspace) => { if (!ws.can("expenses.manage")) throw forbidden("Your role can't add or change expenses."); };
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip } });

  /** The category must be one of the business's list; "Other" needs a short note. */
  async function checkCategory(category: string, note?: string | null) {
    if (!(await expenseCategories(db())).some((c) => c.id === category)) throw badRequest("Choose a category from the list.");
    if (category === "other" && (note ?? "").trim().length < 3) throw badRequest("Say what \"Other\" is for, in a few words.");
  }

  const present = (e: Prisma.ExpenseGetPayload<object>, names: Map<string, string>) => ({
    id: e.id, no: expenseNo(e.seq), status: e.status, date: day(e.spentOn)!, category: e.category, amount: e.amount, vendor: e.vendor ?? "", note: e.note ?? "", method: e.method,
    branchId: e.branchId, branch: names.get(e.branchId) ?? "", hasReceipt: !!e.receiptFile, recurringId: e.recurringId, forMonth: e.forMonth,
  });
  const presentRecurring = (r: Prisma.RecurringExpenseGetPayload<object>, names: Map<string, string>) => ({
    id: r.id, status: r.status, category: r.category, amount: r.amount, vendor: r.vendor ?? "", note: r.note ?? "", method: r.method, dayOfMonth: r.dayOfMonth, startMonth: r.startMonth, branchId: r.branchId, branch: names.get(r.branchId) ?? "",
  });
  const findExpense = async (ws: Workspace, request: FastifyRequest, id: string) => {
    const v = await branchView(db(), request, ws);
    const e = await db().expense.findFirst({ where: { id: id.slice(0, 40), tenantId: ws.tenantId, ...inView(v) } });
    if (!e || e.status === "skipped") throw notFound("Expense not found.");
    return { e, v };
  };

  // ───── The list ─────
  app.get("/expenses", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const q = z.object({ status: z.enum(["confirmed", "draft", "all"]).default("all"), month: Month.optional(), category: z.string().max(60).optional() }).parse(request.query);
    const v = await branchView(db(), request, ws);
    await generateDueExpenses(db(), { today: nepalDay(), tenantId: ws.tenantId });
    const names = new Map(v.mine.map((b) => [b.id, b.name]));
    const where: Prisma.ExpenseWhereInput = {
      tenantId: ws.tenantId, ...inView(v), status: q.status === "all" ? { in: ["confirmed", "draft"] } : q.status,
      ...(q.month ? { spentOn: { gte: dayOf(monthSpan(q.month).first), lte: dayOf(monthSpan(q.month).last) } } : {}), ...(q.category ? { category: q.category } : {}),
    };
    const [rows, drafts, categories] = await Promise.all([
      db().expense.findMany({ where, orderBy: [{ spentOn: "desc" }, { seq: "desc" }], take: 2000 }),
      db().expense.count({ where: { tenantId: ws.tenantId, ...inView(v), status: "draft" } }),
      expenseCategories(db()),
    ]);
    return { data: { canManage: ws.can("expenses.manage"), categories, methods: EXPENSE_METHODS, drafts, rows: rows.map((e) => present(e, names)) } };
  });

  // ───── Add ─────
  app.post("/expenses", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = ExpenseBody.parse(request.body);
    await checkCategory(b.category, b.note);
    const branchId = branchFor(await branchView(db(), request, ws), b.branchId);
    const e = await db().expense.create({ data: { tenantId: ws.tenantId, branchId, status: "confirmed", spentOn: dayOf(b.date), category: b.category, amount: b.amount, vendor: b.vendor || null, note: b.note || null, method: b.method, createdBy: ws.user.id, confirmedBy: ws.user.id, confirmedAt: new Date() } });
    await audit(ws, request.ip, "expense.added", `${expenseNo(e.seq)} Rs. ${e.amount}`);
    const names = new Map((await branchView(db(), request, ws)).mine.map((x) => [x.id, x.name]));
    return { message: `${expenseNo(e.seq)} saved.`, data: present(e, names) };
  });

  // ───── Change (a confirmed expense, or a draft before confirming) ─────
  app.put<{ Params: { id: string } }>("/expenses/:id", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = ExpenseBody.omit({ branchId: true }).parse(request.body);
    const { e, v } = await findExpense(ws, request, request.params.id);
    await checkCategory(b.category, b.note);
    const done = await db().expense.update({ where: { id: e.id }, data: { spentOn: dayOf(b.date), category: b.category, amount: b.amount, vendor: b.vendor || null, note: b.note || null, method: b.method } });
    await audit(ws, request.ip, "expense.changed", `${expenseNo(e.seq)} Rs. ${e.amount} → ${done.amount}`);
    return { message: `${expenseNo(e.seq)} saved.`, data: present(done, new Map(v.mine.map((x) => [x.id, x.name]))) };
  });

  // ───── Confirm a draft (the amount and more can be changed first) ─────
  app.post<{ Params: { id: string } }>("/expenses/:id/confirm", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = z.object({ date: Day.optional(), category: Fields.category.optional(), amount: Amount.optional(), vendor: Fields.vendor, note: Fields.note, method: z.enum(EXPENSE_METHODS).optional() }).parse(request.body ?? {});
    const { e, v } = await findExpense(ws, request, request.params.id);
    if (e.status !== "draft") throw badRequest("Only a draft can be confirmed.");
    const next = { spentOn: b.date ? dayOf(b.date) : e.spentOn, category: b.category ?? e.category, amount: b.amount ?? e.amount, vendor: b.vendor === undefined ? e.vendor : b.vendor || null, note: b.note === undefined ? e.note : b.note || null, method: b.method ?? e.method };
    await checkCategory(next.category, next.note);
    // Taken only if it is still a draft, so two people confirming at once confirm it once.
    const took = await db().expense.updateMany({ where: { id: e.id, status: "draft" }, data: { ...next, status: "confirmed", confirmedBy: ws.user.id, confirmedAt: new Date() } });
    if (!took.count) throw badRequest("Someone already confirmed this expense.");
    await audit(ws, request.ip, "expense.confirmed", `${expenseNo(e.seq)} Rs. ${next.amount}`);
    const done = await db().expense.findUniqueOrThrow({ where: { id: e.id } });
    return { message: `${expenseNo(e.seq)} confirmed.`, data: present(done, new Map(v.mine.map((x) => [x.id, x.name]))) };
  });

  // ───── Delete (one made by a recurring expense is skipped, and stays out of the way) ─────
  app.delete<{ Params: { id: string } }>("/expenses/:id", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const { e } = await findExpense(ws, request, request.params.id);
    if (e.recurringId) await db().expense.update({ where: { id: e.id }, data: { status: "skipped" } });
    else await db().expense.delete({ where: { id: e.id } });
    await audit(ws, request.ip, e.recurringId ? "expense.skipped" : "expense.deleted", `${expenseNo(e.seq)} Rs. ${e.amount}`);
    return { message: e.recurringId ? `${expenseNo(e.seq)} skipped.` : `${expenseNo(e.seq)} deleted.` };
  });

  // ───── Receipt: a photo or PDF, kept private ─────
  app.post<{ Params: { id: string } }>("/expenses/:id/receipt", { bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const { e } = await findExpense(ws, request, request.params.id);
    const b = z.object({ data: z.string().min(16).max(11 * 1024 * 1024) }).parse(request.body);
    const receiptFile = await savePrivateFile(app.config.MEDIA_DIR, "expenses", Buffer.from(b.data, "base64"));
    await db().expense.update({ where: { id: e.id }, data: { receiptFile } });
    return { message: "Receipt saved." };
  });
  app.get<{ Params: { id: string } }>("/expenses/:id/receipt", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const { e } = await findExpense(ws, request, request.params.id);
    const f = e.receiptFile ? await readPrivateFile(app.config.MEDIA_DIR, "expenses", e.receiptFile) : null;
    if (!f) throw notFound("This expense has no receipt.");
    return { data: { type: f.type, data: f.data.toString("base64") } };
  });
  app.delete<{ Params: { id: string } }>("/expenses/:id/receipt", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const { e } = await findExpense(ws, request, request.params.id);
    await db().expense.update({ where: { id: e.id }, data: { receiptFile: null } });
    return { message: "Receipt removed." };
  });

  // ───── Recurring expenses ─────
  app.get("/expenses/recurring", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const v = await branchView(db(), request, ws);
    const rows = await db().recurringExpense.findMany({ where: { tenantId: ws.tenantId, ...inView(v) }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
    const names = new Map(v.mine.map((b) => [b.id, b.name]));
    return { data: rows.map((r) => presentRecurring(r, names)) };
  });

  app.post("/expenses/recurring", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = RecurringBody.parse(request.body);
    await checkCategory(b.category, b.note);
    const v = await branchView(db(), request, ws);
    const branchId = branchFor(v, b.branchId);
    const r = await db().recurringExpense.create({ data: { tenantId: ws.tenantId, branchId, category: b.category, amount: b.amount, vendor: b.vendor || null, note: b.note || null, method: b.method, dayOfMonth: b.dayOfMonth, startMonth: b.startMonth ?? nepalDay().slice(0, 7), createdBy: ws.user.id } });
    await generateDueExpenses(db(), { today: nepalDay(), tenantId: ws.tenantId });
    await audit(ws, request.ip, "expense.recurring_added", `${r.category} Rs. ${r.amount} on day ${r.dayOfMonth}`);
    return { message: `Added. A draft is made on day ${r.dayOfMonth} of every month, for you to confirm.`, data: presentRecurring(r, new Map(v.mine.map((x) => [x.id, x.name]))) };
  });

  const findRecurring = async (ws: Workspace, request: FastifyRequest, id: string) => {
    const v = await branchView(db(), request, ws);
    const r = await db().recurringExpense.findFirst({ where: { id: id.slice(0, 40), tenantId: ws.tenantId, ...inView(v) } });
    if (!r) throw notFound("Recurring expense not found.");
    return { r, v };
  };

  app.put<{ Params: { id: string } }>("/expenses/recurring/:id", async (request) => {
    const ws = workspaceOf(request); canWrite(ws);
    const b = RecurringBody.omit({ branchId: true, startMonth: true }).parse(request.body);
    const { r, v } = await findRecurring(ws, request, request.params.id);
    if (r.status === "stopped") throw badRequest("A stopped recurring expense can't be changed.");
    await checkCategory(b.category, b.note);
    const done = await db().recurringExpense.update({ where: { id: r.id }, data: { category: b.category, amount: b.amount, vendor: b.vendor || null, note: b.note || null, method: b.method, dayOfMonth: b.dayOfMonth } });
    await audit(ws, request.ip, "expense.recurring_changed", `${r.category} Rs. ${r.amount} → ${done.amount}`);
    return { message: "Saved. Drafts already made keep their amount.", data: presentRecurring(done, new Map(v.mine.map((x) => [x.id, x.name]))) };
  });

  for (const [action, from, to, said] of [["pause", "active", "paused", "Paused. No drafts are made until you resume it."], ["resume", "paused", "active", "Resumed."], ["stop", "active,paused", "stopped", "Stopped. Its past expenses stay in your records."]] as const) {
    app.post<{ Params: { id: string } }>(`/expenses/recurring/:id/${action}`, async (request) => {
      const ws = workspaceOf(request); canWrite(ws);
      const { r } = await findRecurring(ws, request, request.params.id);
      const took = await db().recurringExpense.updateMany({ where: { id: r.id, status: { in: from.split(",") } }, data: { status: to } });
      if (!took.count) throw badRequest(r.status === "stopped" ? "It is already stopped." : `It can't be ${to === "active" ? "resumed" : to} now.`);
      await audit(ws, request.ip, `expense.recurring_${to}`, `${r.category} Rs. ${r.amount}`);
      if (to === "active") await generateDueExpenses(db(), { today: nepalDay(), tenantId: ws.tenantId });
      return { message: said };
    });
  }

  // ───── Profit by month and branch ─────
  app.get("/expenses/profit", async (request) => {
    const ws = workspaceOf(request); canView(ws);
    const now = nepalDay().slice(0, 7);
    const q = z.object({ from: Month.optional(), to: Month.optional() }).parse(request.query);
    const to = q.to ?? now;
    // The last 12 months unless asked otherwise.
    let [fy, fm] = to.split("-").map(Number) as [number, number];
    fm -= 11; if (fm < 1) { fm += 12; fy--; }
    const from = q.from ?? `${fy}-${String(fm).padStart(2, "0")}`;
    if (from > to) throw badRequest("The first month is after the last month.");
    if (monthsBetween(from, to).length > 36) throw badRequest("Choose up to 36 months.");
    const v = await branchView(db(), request, ws);
    const rows = await profitRows(db(), { tenantId: ws.tenantId, branchIds: v.ids, branchNames: new Map(v.mine.map((b) => [b.id, b.name])), from, to });
    const sum = (k: "direct" | "vat" | "payouts" | "commission" | "expenses" | "profit") => rows.reduce((s, r) => s + r[k], 0);
    return { data: { from, to, rows, totals: { direct: sum("direct"), vat: sum("vat"), payouts: sum("payouts"), commission: sum("commission"), expenses: sum("expenses"), profit: sum("profit") } } };
  });
}

/** Adds recurring expenses as drafts every 6 hours (and shortly after start). Safe to repeat: one draft per month. The
 *  page also adds due drafts when it opens, so nothing waits for the job. */
export const expenseJob = (app: FastifyInstance): JobSpec => ({
  id: "expenses.recurring", everyMs: 6 * 3600_000, firstRunMs: 45_000, failMessage: "recurring expenses failed",
  run: () => generateDueExpenses(dbOf(app), { today: nepalDay() })
    .then((n) => { if (n) app.log.info({ drafts: n }, "recurring expenses"); }),
});
/** The old entry point, kept as a shim over the jobs registry (it starts the job on its own, as before). */
export function startExpenseJob(app: FastifyInstance) { startJobs(app, [expenseJob(app)], { enabled: true }); }
