// Payouts: the money Sheetal collects for a business, the commission it keeps, and when the rest is paid out.
// Where it fits: recordCollected() is called wherever Sheetal receives money for a business (online booking
// payments, Pay rent, reservation instalments, site bookings); the admin API runs the payouts; the business
// panel's Payouts page reads them.
// How it works: each payment becomes a waiting PayoutItem with the commission worked out at that moment (the rate
// follows the business type: stays, projects, agency or investments, set by Sheetal staff). A payout run puts the
// waiting items that are older than the hold days into one payout per business and branch.
// Rules: whole rupees only; a business that collects its own money (payments mode "own") never gets items; the
// same payment is never counted twice; a refund (negative amount) is kept as "<ref>:refund", so it can be recorded
// with the same ref as the payment it returns; dates are Nepal dates (UTC+5:45).

import type { Db } from "../lib/db.js";
import { badRequest } from "../lib/errors.js";
import { dayOf, ymd } from "./money.js";

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export const SOURCES = ["booking", "reservation", "commitment", "rent", "ota", "other"] as const;
export const MAX_AMOUNT = 2_000_000_000;

export interface PayoutSettings {
  /** Commission in per cent, by what the business does. */
  commission: { stays: number; projects: number; agency: number; investments: number };
  /** The weekday payouts are run. */
  day: string;
  /** Money collected in the last N days is held back (refunds and chargebacks settle first). */
  holdDays: number;
}
export const PAYOUT_DEFAULTS: PayoutSettings = { commission: { stays: 10, projects: 1, agency: 0, investments: 2 }, day: "friday", holdDays: 2 };

const RATE_OF_TYPE: Record<string, keyof PayoutSettings["commission"]> = { hotel: "stays", host: "stays", developer: "projects", agency: "agency", sponsor: "investments" };

/** The platform's payout settings, with the defaults for anything not set yet. */
export async function payoutSettings(db: Db): Promise<PayoutSettings> {
  const v = ((await db.appSetting.findUnique({ where: { key: "payouts" } }))?.value ?? {}) as Partial<PayoutSettings>;
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : d);
  const c = (v.commission ?? {}) as Partial<PayoutSettings["commission"]>;
  return {
    commission: { stays: num(c.stays, PAYOUT_DEFAULTS.commission.stays), projects: num(c.projects, PAYOUT_DEFAULTS.commission.projects), agency: num(c.agency, PAYOUT_DEFAULTS.commission.agency), investments: num(c.investments, PAYOUT_DEFAULTS.commission.investments) },
    day: typeof v.day === "string" && (WEEKDAYS as readonly string[]).includes(v.day) ? v.day : PAYOUT_DEFAULTS.day,
    holdDays: typeof v.holdDays === "number" && Number.isInteger(v.holdDays) && v.holdDays >= 0 ? v.holdDays : PAYOUT_DEFAULTS.holdDays,
  };
}

/** The commission rate for a business type, in hundredths of a percent (10% = 1000). */
export const commissionBp = (s: PayoutSettings, tenantType: string) => Math.round((s.commission[RATE_OF_TYPE[tenantType] ?? "stays"] ?? 0) * 100);

/** The commission on an amount, in whole rupees (a refund gives a negative commission back). */
export const feeOf = (gross: number, bp: number) => Math.round((gross * bp) / 10_000);

/** PO-0007 */
export const payoutNo = (seq: number) => `PO-${String(seq).padStart(4, "0")}`;

/** Today in Nepal (UTC+5:45), as YYYY-MM-DD. */
export const nepalDay = (now = new Date()) => ymd(new Date(now.getTime() + 5.75 * 3_600_000));

/** The next day (today included) that falls on this weekday. */
export function nextPayoutOn(today: string, weekday: string) {
  const want = Math.max(0, (WEEKDAYS as readonly string[]).indexOf(weekday));
  const d = dayOf(today);
  d.setUTCDate(d.getUTCDate() + ((want - d.getUTCDay() + 7) % 7));
  return ymd(d);
}

/** Money collected on or before this day is old enough to be paid out. */
export function holdCutoff(today: string, holdDays: number) {
  const d = dayOf(today);
  d.setUTCDate(d.getUTCDate() - holdDays);
  return ymd(d);
}

/** Where a payout goes, from the business's payment settings; null when it collects its own money or has no account yet. */
export function bankOf(settings: unknown): { bank: string; holder: string; account: string; branch: string } | null {
  const pay = (settings as { payments?: { mode?: string; payoutBank?: Record<string, unknown> } } | null)?.payments;
  if (!pay || pay.mode === "own") return null;
  const b = pay.payoutBank ?? {};
  const s = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  return s(b.account) ? { bank: s(b.bank), holder: s(b.holder), account: s(b.account), branch: s(b.branch) } : null;
}

/** What the business may see of an account: the bank, the holder and the last four digits. */
export function maskBank(bank: unknown) {
  const b = (bank ?? {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  return { bank: s(b.bank), holder: s(b.holder), last4: s(b.account).slice(-4) };
}

/** The branch money belongs to when the caller doesn't say: the business's first open branch. */
async function defaultBranch(db: Db, tenantId: string) {
  const b = (await db.branch.findFirst({ where: { tenantId, status: "open" }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } }))
    ?? (await db.branch.findFirst({ where: { tenantId }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } }));
  return b?.id ?? null;
}

export interface Collected {
  tenantId: string;
  /** The branch the money belongs to; the business's first open branch when empty. */
  branchId?: string | null;
  source: (typeof SOURCES)[number];
  /** What it came from (BK-0007, a receipt number): the same one is never recorded twice. A refund uses the same
   *  ref as its payment. */
  ref: string;
  what: string;
  /** Whole rupees received by Sheetal; negative for a refund. */
  gross: number;
  /** The day it was received (YYYY-MM-DD, Nepal); today when empty. */
  on?: string;
}

/** Records money Sheetal collected for a business. Returns true when it was added, false when it was already
 *  recorded or the business collects its own payments. */
export async function recordCollected(db: Db, c: Collected): Promise<boolean> {
  if (!Number.isInteger(c.gross) || c.gross === 0 || Math.abs(c.gross) > MAX_AMOUNT) throw badRequest("A collected amount is a whole number of rupees, not zero (negative for a refund).");
  if (!c.ref.trim()) throw badRequest("Say what the money came from.");
  const ref = c.gross < 0 ? `${c.ref.trim().slice(0, 53)}:refund` : c.ref.trim().slice(0, 60);
  const tenant = await db.tenant.findUnique({ where: { id: c.tenantId }, select: { type: true, settings: true } });
  if (!tenant) return false;
  if ((tenant.settings as { payments?: { mode?: string } } | null)?.payments?.mode === "own") return false;
  let branchId = c.branchId ?? null;
  if (branchId) { if (!(await db.branch.count({ where: { id: branchId, tenantId: c.tenantId } }))) throw badRequest("That branch isn't in this business."); }
  else branchId = await defaultBranch(db, c.tenantId);
  if (!branchId) throw badRequest("The business has no branch.");
  const bp = commissionBp(await payoutSettings(db), tenant.type);
  const fee = feeOf(c.gross, bp);
  const made = await db.payoutItem.createMany({
    data: [{ tenantId: c.tenantId, branchId, source: c.source, ref, what: c.what.trim().slice(0, 160) || c.source, gross: c.gross, feeBp: bp, fee, net: c.gross - fee, collectedOn: dayOf(c.on ?? nepalDay()) }],
    skipDuplicates: true,
  });
  return made.count > 0;
}
