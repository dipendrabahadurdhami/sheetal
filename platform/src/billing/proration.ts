// Proration in paisa (MB section 5.3): a share of a price for the days left of a period, worked out exactly and rounded once.
// Where it fits: the quote (quote.ts) for co-terming a new app, upgrades, month-to-year switches and add-ons bought mid-period.
// How it works: share(price, left, total) = price × left / total with BigInt maths, rounded half away from zero (the Money rule).
// Days are Nepal days (days.ts): "today counts as a full day left".
// Rules: pure. Never a fixed 30-day month; never floating point on money.

import { Money } from "../core/money.js";
import { nepalDays } from "./days.js";

/** price × num / den, exact, rounded half away from zero. */
export function share(price: Money, num: number, den: number): Money {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0 || num < 0) throw new Error(`Bad proration ${num}/${den}.`);
  const n = BigInt(price.paisa) * BigInt(num);
  const d = BigInt(den);
  const q = n / d;
  const r = n % d;
  const abs = r < 0n ? -r : r;
  const rounded = abs * 2n >= d ? (n < 0n ? q - 1n : q + 1n) : q;
  return Money.paisa(r === 0n ? q : rounded);
}

/** Days left (today counts) and the period's length, both in Nepal days. */
export function periodDays(now: Date, periodStart: Date, periodEnd: Date): { left: number; total: number } {
  const total = Math.max(nepalDays(periodStart, periodEnd), 1);
  const left = Math.min(Math.max(nepalDays(now, periodEnd), 0), total);
  return { left, total };
}

/** Upgrade mid-period (worked example 1): credit for the old price's days left, charge for the new one's; due never below 0. */
export function upgrade(oldGross: Money, newGross: Money, left: number, total: number): { credit: Money; charge: Money; due: Money } {
  const credit = share(oldGross, left, total);
  const charge = share(newGross, left, total);
  const due = charge.minus(credit);
  return { credit, charge, due: due.isNegative() ? Money.zero() : due };
}
