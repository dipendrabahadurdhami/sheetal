// The proration table (P3-QA-1): the three worked examples of MARKETPLACE-AND-BILLING.md section 5.3 and the edge cases around them
// (rounding halves, month ends, leap days, Nepal midnight, yearly periods, VAT splits). Every expected number was worked out separately
// with exact fractions (rounded half away from zero), not by running the code under test.
// Where it fits: platform/test/billing-core.test.ts runs every row; later tasks (invoices, renewals) reuse the same rows.
// Rules: data only. Dates: a "Nepal midnight" in UTC is 18:15 of the day before (Nepal is UTC+05:45).

/** The first instant of a Nepal calendar date, written out by hand (not with the code under test). */
export const NPT = (ymd: string) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() - (5 * 60 + 45) * 60_000);

export const SHARE_CASES: { name: string; price: number; left: number; total: number; want: number }[] = [
  { name: "example 1 credit: Rs 400 for 12 of 30 days", price: 40_000, left: 12, total: 30, want: 16_000 },
  { name: "example 1 charge: Rs 700 for 12 of 30 days", price: 70_000, left: 12, total: 30, want: 28_000 },
  { name: "example 2: Rs 300 joins 14 days before the anchor in a 30-day cycle", price: 30_000, left: 14, total: 30, want: 14_000 },
  { name: "one day of a 31-day month rounds up", price: 30_000, left: 1, total: 31, want: 968 },
  { name: "the whole period is the whole price", price: 30_000, left: 31, total: 31, want: 30_000 },
  { name: "no days left is nothing", price: 30_000, left: 0, total: 30, want: 0 },
  { name: "29-day February, 15 days left", price: 40_000, left: 15, total: 29, want: 20_690 },
  { name: "28-day February, half", price: 40_000, left: 14, total: 28, want: 20_000 },
  { name: "a third rounds down", price: 50_000, left: 1, total: 3, want: 16_667 },
  { name: "two thirds rounds down", price: 50_000, left: 2, total: 3, want: 33_333 },
  { name: "exactly half a paisa rounds away from zero (7.5)", price: 15, left: 1, total: 2, want: 8 },
  { name: "exactly half a paisa rounds away from zero (12.5)", price: 25, left: 1, total: 2, want: 13 },
  { name: "yearly price, 100 of 365 days", price: 400_000, left: 100, total: 365, want: 109_589 },
  { name: "yearly price in a leap year, 183 of 366 days", price: 400_000, left: 183, total: 366, want: 200_000 },
  { name: "a third of one paisa is nothing", price: 1, left: 1, total: 3, want: 0 },
  { name: "two thirds of one paisa is one", price: 2, left: 1, total: 3, want: 1 },
  { name: "one day of a 30-day month", price: 30_000, left: 1, total: 30, want: 1_000 },
];

export const UPGRADE_CASES: { name: string; old: number; next: number; left: number; total: number; want: { credit: number; charge: number; due: number } }[] = [
  { name: "example 1: Full Rs 400 to Pro Rs 700, 12 of 30 days", old: 40_000, next: 70_000, left: 12, total: 30, want: { credit: 16_000, charge: 28_000, due: 12_000 } },
  { name: "on the first day: the whole difference", old: 40_000, next: 70_000, left: 30, total: 30, want: { credit: 40_000, charge: 70_000, due: 30_000 } },
  { name: "on the last day of a 31-day month", old: 40_000, next: 70_000, left: 1, total: 31, want: { credit: 1_290, charge: 2_258, due: 968 } },
  { name: "to a cheaper price: never a negative due", old: 30_000, next: 20_000, left: 10, total: 30, want: { credit: 10_000, charge: 6_667, due: 0 } },
];

export const VAT_CASES: { name: string; total: number; want: { subtotal: number; vat: number } }[] = [
  { name: "example 1 due Rs 120", total: 12_000, want: { subtotal: 10_619, vat: 1_381 } },
  { name: "example 3: Rs 400 with 20% off", total: 32_000, want: { subtotal: 28_319, vat: 3_681 } },
  { name: "Rs 400", total: 40_000, want: { subtotal: 35_398, vat: 4_602 } },
  { name: "113 paisa", total: 113, want: { subtotal: 100, vat: 13 } },
  { name: "one paisa has no VAT", total: 1, want: { subtotal: 1, vat: 0 } },
  { name: "zero", total: 0, want: { subtotal: 0, vat: 0 } },
];

export const DAY_CASES: { name: string; now: Date; start: Date; end: Date; want: { left: number; total: number } }[] = [
  { name: "one minute before Nepal midnight is still the 13th", now: new Date("2026-11-13T18:14:00Z"), start: NPT("2026-11-01"), end: NPT("2026-12-01"), want: { left: 18, total: 30 } },
  { name: "Nepal midnight starts the 14th (18:15 UTC)", now: new Date("2026-11-13T18:15:00Z"), start: NPT("2026-11-01"), end: NPT("2026-12-01"), want: { left: 17, total: 30 } },
  { name: "leap day: the last day of February 2028", now: new Date("2028-02-29T06:00:00Z"), start: NPT("2028-02-01"), end: NPT("2028-03-01"), want: { left: 1, total: 29 } },
  { name: "a whole year from Shrawan", now: NPT("2026-07-17"), start: NPT("2026-07-17"), end: NPT("2027-07-17"), want: { left: 365, total: 365 } },
];

export const ANCHOR_CASES: { name: string; fn: "next" | "previous" | "addMonth"; at: Date; anchor: number; months?: number; want: Date }[] = [
  { name: "on the anchor day, the next anchor is next month", fn: "next", at: new Date("2026-11-14T05:00:00Z"), anchor: 14, want: NPT("2026-12-14") },
  { name: "the day before the anchor, the next anchor is tomorrow", fn: "next", at: new Date("2026-11-13T05:00:00Z"), anchor: 14, want: NPT("2026-11-14") },
  { name: "the next anchor crosses the year", fn: "next", at: NPT("2026-12-20"), anchor: 5, want: NPT("2027-01-05") },
  { name: "on the anchor day, the previous anchor is today", fn: "previous", at: new Date("2026-11-14T05:00:00Z"), anchor: 14, want: NPT("2026-11-14") },
  { name: "a month after the 31st lands on the 28th", fn: "addMonth", at: NPT("2027-01-31"), anchor: 28, months: 1, want: NPT("2027-02-28") },
  { name: "twelve months on", fn: "addMonth", at: NPT("2026-11-14"), anchor: 14, months: 12, want: NPT("2027-11-14") },
];
