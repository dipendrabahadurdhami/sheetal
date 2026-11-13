// Coupons (MB sections 5.3 and 15): a code that lowers one purchase by a percent or a fixed amount, or adds trial days.
// Where it fits: the quote applies at most one coupon per invoice; POST /coupons/check (P3-BE-6) shows the same answer before checkout.
// How it works: check() says whether the coupon may be used here (active, dates, limits, first purchase, minimum spend, which apps);
// discount() spreads the money off over the eligible lines in proportion to their price, so no line goes below zero and the parts add up.
// Rules: pure. Applied to the gross (VAT included) after proration, before the VAT split. A coupon never makes a line negative.

import { Money } from "../core/money.js";
import type { CouponInput, Text } from "./types.js";

export interface CouponLine { appId: string | null; editionId: string | null; grossPaisa: number }

/** Refusal words, or null when the coupon may be used. */
export function checkCoupon(c: CouponInput, o: { now: Date; firstPurchase: boolean; usesByBusiness: number; usesTotal: number; eligibleGrossPaisa: number }): Text | null {
  if (!c.active) return { en: "This code isn't active." };
  if (c.validFrom && o.now < c.validFrom) return { en: "This code can't be used yet." };
  if (c.validTo && o.now > c.validTo) return { en: "This code has ended." };
  if (c.maxRedemptions != null && o.usesTotal >= c.maxRedemptions) return { en: "This code has been used up." };
  if (o.usesByBusiness >= Math.max(c.perBusinessLimit, 1)) return { en: "Your business has already used this code." };
  if (c.firstPurchaseOnly && !o.firstPurchase) return { en: "This code is only for a first purchase." };
  if (c.kind !== "trial_days" && o.eligibleGrossPaisa <= 0) return { en: "This code doesn't apply to anything in your cart." };
  if (c.minSpendPaisa != null && o.eligibleGrossPaisa < c.minSpendPaisa) return { en: `This code needs a spend of at least Rs ${Money.paisa(c.minSpendPaisa).toString()}.` };
  return null;
}

/** Whether a line can take the coupon. */
export function couponApplies(c: CouponInput, line: { appId: string | null; editionId: string | null }): boolean {
  if (c.appliesTo === "all") return true;
  if (!line.appId) return false;
  if (c.appliesTo === "apps") return c.appIds.includes(line.appId);
  return c.editionIds.includes(`${line.appId}:${line.editionId}`) || (!!line.editionId && c.editionIds.includes(line.editionId));
}

/** The discount per line (same order as `lines`), each between 0 and the line's gross. Lines that can't take it get 0. */
export function couponDiscounts(c: CouponInput, lines: CouponLine[]): Money[] {
  const eligible = lines.map((l) => (l.grossPaisa > 0 && couponApplies(c, l) ? l.grossPaisa : 0));
  const base = Money.paisa(eligible.reduce((a, b) => a + b, 0));
  if (base.isZero() || c.kind === "trial_days") return lines.map(() => Money.zero());
  let off = c.kind === "percent" ? base.percent(Math.min(Math.max(c.value, 0), 100)) : Money.paisa(Math.max(c.value, 0));
  if (off.compare(base) > 0) off = base;
  if (off.isZero()) return lines.map(() => Money.zero());
  return off.split(eligible);
}
