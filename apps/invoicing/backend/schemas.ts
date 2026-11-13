// The input shapes of Invoicing, unchanged from the old route file (P2-W3), plus an optional `version` on a draft save.

import { z } from "zod";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";

export const METHODS = ["cash", "fonepay", "esewa", "khalti", "card", "bank", "other"] as const;
export const MAX = 2_000_000_000;
export const DUE_DAYS = 10;

export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => ymd(dayOf(s)) === s, "That date doesn't exist.");
const Line = z.object({ what: z.string().trim().min(1, "Every line needs an item.").max(160), qty: z.number().int().min(1).max(99_999), rate: z.number().int().min(-100_000_000).max(100_000_000) });
const Vat = z.number().refine((v) => v === 0 || v === 13, "VAT is 13% or none.");
export const Draft = z.object({
  to: z.string().trim().min(1, "Who is the invoice for?").max(120),
  phone: z.string().trim().max(30).nullish(),
  pan: z.string().trim().regex(/^\d{0,9}$/, "PAN is 9 digits.").nullish(),
  order: z.string().trim().max(40).nullish(),
  date: Day, due: Day, vatPct: Vat,
  notes: z.string().trim().max(1000).nullish(),
  lines: z.array(Line).min(1, "Add at least one line.").max(100),
  branchId: z.string().max(40).nullish(),
});
export type DraftBody = z.infer<typeof Draft>;
export const Save = Draft.extend({ send: z.boolean().default(false), version: z.number().int().min(1).optional() });

const text = (max: number) => z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().max(max));
const opt = (max: number) => z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v == null ? undefined : String(v).trim() || undefined)).pipe(z.string().max(max).optional());
const num = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v === "" || v == null ? undefined : Number(v))).pipe(z.number().int().min(0).max(MAX).optional());
export const ImportRow = z.object({ to: text(120).pipe(z.string().min(1, "Customer is missing.")), phone: opt(30), pan: opt(9), date: Day, item: text(160).pipe(z.string().min(1, "Item is missing.")), amount: num.refine((n) => !!n, "Amount is missing."), vat: num, paid: num });
export const Import = z.object({ rows: z.array(ImportRow).min(1, "There are no rows to import.").max(500, "Import up to 500 invoices at a time.") });
export const Receipt = z.object({ amount: z.number().int().min(1).max(MAX), method: z.enum(METHODS), at: Day, note: z.string().trim().max(200).nullish() });
export const Cancel = z.object({ reason: z.string().trim().min(1, "Give a reason.").max(200) });
export const Credit = z.object({ amount: z.number().int().min(1).max(MAX), reason: z.string().trim().min(1, "Give a reason.").max(200), date: Day.optional() });
export const FromBooking = z.object({ booking: z.string().trim().max(20), date: Day.optional() });
