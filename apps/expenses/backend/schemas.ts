// What the Expenses screens send, and the shape it is saved in.
// Where it fits: parsed by ExpenseService / RecurringExpenseService (the one place input is checked). Moved from routes.ts (P1-BE-5), same rules and messages.
// How it works: the zod objects are the ones the route file had. Each create/update schema also turns the screen's whole-rupee `amount` into BOTH stored
// columns (amount in rupees and amountPaisa) and a blank vendor/note into null, so the service never repeats that.
// Rules: the bodies are NOT .strict() (as before): an unknown key such as `version` is simply not part of the parsed data; the service reads `version`
// from the raw body itself. `amount` is whole rupees, 1 to MAX_EXPENSE.

import { z } from "zod";
import { badRequest } from "@sheetal/platform/core/errors";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { EXPENSE_METHODS, MAX_EXPENSE } from "./categories.js";
import { amountColumns } from "./money.js";

export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.");
export const Amount = z.number().int("Use whole rupees.").min(1, "The amount must be more than zero.").max(MAX_EXPENSE);
export const Fields = {
  category: z.string().trim().min(1, "Choose a category.").max(60),
  amount: Amount,
  vendor: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(300).nullish(),
  method: z.enum(EXPENSE_METHODS).default("cash"),
  branchId: z.string().max(40).nullish(),
};
export const ExpenseBody = z.object({ date: Day, ...Fields });
export const RecurringBody = z.object({ ...Fields, dayOfMonth: z.number().int().min(1, "Choose a day from 1 to 28.").max(28, "Choose a day from 1 to 28."), startMonth: Month.optional() });
export const ConfirmBody = z.object({ date: Day.optional(), category: Fields.category.optional(), amount: Amount.optional(), vendor: Fields.vendor, note: Fields.note, method: z.enum(EXPENSE_METHODS).optional() });
export const ListQuery = z.object({
  status: z.enum(["confirmed", "draft", "all"]).default("all"), month: Month.optional(), category: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(), per: z.coerce.number().int().min(1).max(200).optional(),
});
export const ProfitQuery = z.object({ from: Month.optional(), to: Month.optional() });
export const ReceiptBody = z.object({ data: z.string().min(16).max(11 * 1024 * 1024) });

// ───── The shapes saved (what the repositories take) ─────

export interface ExpenseCreate {
  branchId?: string | null; spentOn: Date; category: string; amount: number; amountPaisa: bigint; vendor: string | null; note: string | null; method: string;
  /** Set by the service: a new expense is confirmed by the person adding it. */
  status?: "confirmed"; confirmedBy?: string | null; confirmedAt?: Date;
}
export interface ExpenseChange {
  spentOn?: Date; category?: string; amount?: number; amountPaisa?: bigint; vendor?: string | null; note?: string | null; method?: string;
  status?: "confirmed" | "draft" | "skipped"; confirmedBy?: string | null; confirmedAt?: Date | null; receiptFile?: string | null;
}
export interface RecurringCreate {
  branchId?: string | null; category: string; amount: number; amountPaisa: bigint; vendor: string | null; note: string | null; method: string; dayOfMonth: number; startMonth: string;
}
export interface RecurringChange {
  category?: string; amount?: number; amountPaisa?: bigint; vendor?: string | null; note?: string | null; method?: string; dayOfMonth?: number; status?: "active" | "paused" | "stopped";
}

type Body = z.infer<typeof ExpenseBody>;
const fields = (b: { vendor?: string | null; note?: string | null }) => ({ vendor: b.vendor || null, note: b.note || null });

export const CreateExpenseSchema = ExpenseBody.transform((b: Body): ExpenseCreate => ({
  branchId: b.branchId, spentOn: dayOf(b.date), category: b.category, ...amountColumns(b.amount), ...fields(b), method: b.method,
}));
export const UpdateExpenseSchema = ExpenseBody.omit({ branchId: true }).transform((b): ExpenseChange => ({
  spentOn: dayOf(b.date), category: b.category, ...amountColumns(b.amount), ...fields(b), method: b.method,
}));
export const CreateRecurringSchema = RecurringBody.transform((b): RecurringCreate => ({
  branchId: b.branchId, category: b.category, ...amountColumns(b.amount), ...fields(b), method: b.method, dayOfMonth: b.dayOfMonth, startMonth: b.startMonth ?? nepalDay().slice(0, 7),
}));
export const UpdateRecurringSchema = RecurringBody.omit({ branchId: true, startMonth: true }).transform((b): RecurringChange => ({
  category: b.category, ...amountColumns(b.amount), ...fields(b), method: b.method, dayOfMonth: b.dayOfMonth,
}));

/** The `version` a screen says it loaded (optional while the screen does not send it yet): a whole number from 1, or undefined. */
export function versionIn(raw: unknown): number | undefined {
  const v = raw && typeof raw === "object" ? (raw as { version?: unknown }).version : undefined;
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw badRequest("This page is out of date. Reload and try again.");
  return n;
}
