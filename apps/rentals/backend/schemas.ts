// What the Rentals screens send, and the shape it is saved in.
// Where it fits: parsed by the services (the one place input is checked). Moved from the old routes file (P2-W1-S1), same rules and messages.
// How it works: the zod objects are the ones the route file had. Each transform turns the screen's body into the columns that are saved (fee and late-fee
// percentages become hundredths of a percent, blank text becomes null, dates become Date).
// Rules: the bodies are NOT .strict() (as before): an unknown key such as `version` is simply not part of the parsed data; the services read `version` from
// the raw body themselves (versionIn). Amounts are whole rupees.

import { z } from "zod";
import { badRequest } from "@sheetal/platform/core/errors";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { MAX_RENT, RENT_METHODS, UNIT_KINDS } from "./rentals.js";

export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-11.");
export const Rupees = z.number().int("Use whole rupees.").min(0).max(MAX_RENT);
export const Positive = Rupees.refine((n) => n > 0, "The amount must be more than zero.");
export const Text = (max: number) => z.string().trim().max(max).nullish();
export const Pct = (max: number) => z.number().min(0).max(max);
/** A percentage to hundredths of a percent (8 -> 800). */
export const bp = (pct: number) => Math.round(pct * 100);
const orNull = (s: string | null | undefined) => s || null;
const Id = (msg?: string) => (msg ? z.string().min(1, msg).max(40) : z.string().min(1).max(40));

// ───── Bodies ─────

export const OwnerBody = z.object({ name: z.string().trim().min(1, "Write the owner's name.").max(120), phone: Text(30), email: Text(120), feePct: Pct(50).default(8), bank: Text(160), note: Text(300), branchId: z.string().max(40).nullish() });
export const UnitBody = z.object({ ownerId: Id("Choose the owner."), property: z.string().trim().min(1, "Write the building or house name.").max(120), name: z.string().trim().min(1, "Write the unit name.").max(80), kind: z.enum(UNIT_KINDS).default("Flat"), rent: Rupees, status: z.enum(["vacant", "repair"]).optional(), listingId: z.number().int().positive().nullish() });
const LeaseTerms = {
  renter: z.string().trim().min(1, "Write the tenant's name.").max(120), phone: Text(30), email: Text(120), rent: Rupees.refine((n) => n > 0, "Write the monthly rent."),
  dueDay: z.number().int().min(1, "Choose a day from 1 to 28.").max(28, "Choose a day from 1 to 28.").default(7), lateFeePct: Pct(20).default(2), lateAfterDays: z.number().int().min(0).max(60).default(5),
};
export const LeaseBody = z.object({ unitId: Id(), start: Day, end: Day, deposit: Rupees.default(0), ...LeaseTerms });
export const LeaseChangeBody = z.object({ end: Day, ...LeaseTerms });
export const LeaseEndBody = z.object({ endedOn: Day, depositReturned: Rupees.nullish(), depositNote: Text(300) });
export const DepositBody = z.object({ returned: Rupees, note: Text(300) });
export const BillMonthBody = z.object({ month: Month });
export const BillAmountBody = z.object({ amount: Positive });
export const PaymentBody = z.object({ amount: Positive, method: z.enum(RENT_METHODS).default("cash"), paidOn: Day, ref: Text(80), note: Text(300) });
export const RejectBody = z.object({ note: z.string().trim().min(3, "Say why, so the tenant knows.").max(300) });
export const RepairBody = z.object({ title: z.string().trim().min(1, "Say what needs fixing.").max(160), priority: z.enum(["urgent", "normal", "low"]).default("normal"), vendor: Text(120), cost: Rupees.default(0), status: z.enum(["open", "assigned", "done"]).default("open"), doneOn: Day.nullish() });
export const NewRepairBody = RepairBody.extend({ unitId: Id() });
export const StatementQuery = z.object({ month: Month.optional() });
export const StatementBody = z.object({ ownerId: Id(), month: Month });

// ───── The columns saved ─────

export const CreateOwnerSchema = OwnerBody.transform((b) => ({ branchId: b.branchId, name: b.name, phone: orNull(b.phone), email: orNull(b.email), feeBp: bp(b.feePct), bank: orNull(b.bank), note: orNull(b.note) }));
export const UpdateOwnerSchema = OwnerBody.omit({ branchId: true }).transform((b) => ({ name: b.name, phone: orNull(b.phone), email: orNull(b.email), feeBp: bp(b.feePct), bank: orNull(b.bank), note: orNull(b.note) }));
export const UnitSchema = UnitBody;
export const LeaseSchema = LeaseBody;
export const RepairSchema = RepairBody;

/** The terms a lease is saved with (new lease, or change of a running one). */
export const leaseTerms = (b: { renter: string; phone?: string | null; email?: string | null; rent: number; dueDay: number; lateFeePct: number; lateAfterDays: number }) => ({
  renter: b.renter, phone: orNull(b.phone), email: orNull(b.email), rent: b.rent, dueDay: b.dueDay, lateFeeBp: bp(b.lateFeePct), lateAfterDays: b.lateAfterDays,
});
export const orNullText = orNull;

/** The `version` a screen says it loaded (optional while the screens do not send it yet): a whole number from 1, or undefined. */
export function versionIn(raw: unknown): number | undefined {
  const v = raw && typeof raw === "object" ? (raw as { version?: unknown }).version : undefined;
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw badRequest("This page is out of date. Reload and try again.");
  return n;
}
