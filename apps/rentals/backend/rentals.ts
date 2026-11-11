// Rentals rules that need no database: codes, balances, bill status, late fee, management fee and dates.
// Where it fits: moved here from backend-core/src/domain/rentals.ts (P2-W1-S1); that file re-exports everything, so every old import keeps working.
// The services, the bill job and the website's rent-payment code all read these.
// How it works: an active lease gets one bill per month (amount = the lease's rent, due on its due day). A bill that is still not fully paid some days after its
// due date gets a late fee once, on the unpaid balance. An owner statement for a month = rent collected for the owner's units - the agency's management fee - repairs
// done for those units; saving it counts the fee in the agency's profit.
// Rules: rent belongs to the owner, so it is never the agency's income; only the management fee is. A deposit is held and returned, never income. Whole rupees (the
// tables have no paisa columns yet); months are YYYY-MM and days are Nepal dates (nepalDay()).

import { dayOf, ymd } from "@sheetal/backend-core/domain/money";

export const RENT_METHODS = ["cash", "bank", "esewa", "khalti", "fonepay", "cheque", "other"] as const;
export const UNIT_KINDS = ["Flat", "Room", "1 BHK", "2 BHK", "3 BHK", "House", "Shop", "Office", "Other"] as const;
export const MAX_RENT = 100_000_000;

const pad4 = (n: number) => String(n).padStart(4, "0");
/** LS-0007: the lease code (later shown to renters for paying online). */
export const leaseNo = (seq: number) => `LS-${pad4(seq)}`;
export const billNo = (seq: number) => `RB-${pad4(seq)}`;
export const repairNo = (seq: number) => `WO-${pad4(seq)}`;

/** What is still owed on a bill, late fee included. */
export const balanceOf = (b: { amount: number; lateFee: number; paid: number }) => Math.max(0, b.amount + b.lateFee - b.paid);

/** paid, overdue (past the due day and not fully paid), partial or due. */
export function billStatus(b: { amount: number; lateFee: number; paid: number; dueOn: Date }, today: string) {
  if (b.paid >= b.amount + b.lateFee) return "paid";
  if (ymd(b.dueOn) < today) return "overdue";
  return b.paid > 0 ? "partial" : "due";
}

export const addDays = (day: string, n: number) => { const d = dayOf(day); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
/** The last day of a month (YYYY-MM) as YYYY-MM-DD. */
export const lastDayOf = (month: string) => { const [y, m] = month.split("-").map(Number) as [number, number]; return ymd(new Date(Date.UTC(y, m, 0))); };
/** The due date of a month's bill: the lease's due day (1 to 28). */
export const dueDateOf = (month: string, dueDay: number) => `${month}-${String(Math.min(28, Math.max(1, dueDay))).padStart(2, "0")}`;
/** A late fee: a share of the unpaid rent, in hundredths of a percent (200 = 2%). */
export const lateFeeOf = (unpaid: number, bp: number) => Math.round((Math.max(0, unpaid) * bp) / 10_000);
/** The management fee on rent collected, in hundredths of a percent (800 = 8%). */
export const feeOf = (collected: number, bp: number) => Math.round((collected * bp) / 10_000);

/** Whether a lease runs in a month (it started on or before the month's last day and ends on or after its first). */
export const leaseCovers = (l: { startOn: Date; endOn: Date }, month: string) => ymd(l.startOn) <= lastDayOf(month) && ymd(l.endOn) >= `${month}-01`;
