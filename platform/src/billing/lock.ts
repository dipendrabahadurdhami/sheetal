// Price protection for businesses moved from Starter / Business / Pro (MB section 8.3, the owner's answer to Q2): until the lock ends, a
// renewal of the apps the old plan covered costs no more than the old plan did for the same months.
// Where it fits: the quote adds one visible negative line "Price protection until {date}" when the renewal lines of the covered apps add
// up to more than the old price; the lifecycle job (P3-BE-5) builds renewals through the quote, so the protection is always applied.
// How it works: L = the old price for the renewal's months (legacyMonthlyGross × months, or the old plan's own multi-month price when the
// caller passes it: priceFor(price, months) of domain/plans.ts, MB section 8.3). T = the covered renewal total. Protection = T − L when positive.
// Rules: pure. Never makes the invoice cheaper than the old price, never more expensive than the new one; only renewals are protected.

import { Money } from "../core/money.js";
import type { LockState } from "./types.js";

export function lockActive(lock: LockState | null, now: Date): lock is LockState {
  return !!lock && now < lock.lockEnd;
}

/** The (positive) amount to take off a renewal of the covered apps, or zero. */
export function priceProtection(lock: LockState | null, now: Date, coveredRenewalGross: Money, months: number, legacyTotal?: Money): Money {
  if (!lockActive(lock, now) || months <= 0) return Money.zero();
  const old = legacyTotal ?? Money.paisa(lock.legacyMonthlyGrossPaisa).times(months);
  const over = coveredRenewalGross.minus(old);
  return over.isNegative() ? Money.zero() : over;
}
