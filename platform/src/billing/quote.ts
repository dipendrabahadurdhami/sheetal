// The quote (MB section 5.4): the one pure function that turns a cart into invoice lines, so the number a person sees is the number charged.
// Where it fits: the marketplace and cart screens show it (POST /subscriptions/quote, P3-BE-6); the checkout stores the invoice built from
// the same answer (P3-BE-4); the renewal job builds renewals with it (P3-BE-5).
// How it works, per cart item (MB section 5.3):
//   subscribe  first paid monthly app: full price, the anchor becomes today (day of month, at most 28). Another monthly app joining:
//              price × days left / cycle days until the next anchor; fewer than minFirstPeriodDays left: runs to the following anchor.
//              Yearly: full yearly price, its own anniversary.
//   change     upgrade: credit for the old price's days left, charge for the new price's days left, same dates. Month to year: credit the
//              unused month, charge the year from today. Downgrades and year to month are scheduled for the period end (no lines).
//   renew      the next period at the subscription's own (copied) price, starting at the old end while in grace (no gap, no double).
//   addon      unit × qty × days left / days of the parent period.
// Then: one coupon spread over the eligible lines, price protection for a migrated business's covered renewals, a total below the
// minimum charge carried to the next invoice, and VAT split ONCE from the total and shared back to the lines (a line's net + VAT = gross).
// Rules: pure (no clock, no database: `now`, the business and the catalog come in). Never a negative due. Same input = same output.

import { Money } from "../core/money.js";
import { checkCoupon, couponApplies, couponDiscounts } from "./coupon.js";
import { addMonthsOnAnchor, anchorOf, nepalDays, nextAnchor, previousAnchor, startOfNepalDay, addNepalDays } from "./days.js";
import { effectiveStatus } from "./effective-status.js";
import { priceProtection } from "./lock.js";
import { periodDays, share, upgrade } from "./proration.js";
import type { BillingSettings, BillingState, CartItem, Catalog, CouponInput, Quote, QuoteLine, SubscriptionState, Text } from "./types.js";

export interface QuoteInput {
  now: Date;
  business: BillingState;
  items: CartItem[];
  coupon?: CouponInput | null;
  catalog: Catalog;
  settings: BillingSettings;
  /** The old plan's own price for n months (priceFor of domain/plans.ts), for price protection; default legacyMonthly × n. */
  legacyTotalFor?: (months: number) => number;
}

type Draft = Omit<QuoteLine, "netPaisa" | "vatPaisa">;

const day = (d: Date) => {
  const n = new Date(d.getTime() + (5 * 60 + 45) * 60_000);
  return n.toISOString().slice(0, 10);
};

/** A paid period that is still running (or in grace) at `now`. */
function running(sub: SubscriptionState | undefined, now: Date): sub is SubscriptionState & { currentPeriodEnd: Date } {
  return !!sub && sub.periodMonths != null && !!sub.currentPeriodEnd && now < sub.currentPeriodEnd && !sub.uninstalledAt;
}

export function quote(input: QuoteInput): Quote {
  const { now, business, catalog, settings } = input;
  const errors: Text[] = [];
  const notes: Text[] = [];
  const warnings: Text[] = [];
  const drafts: Draft[] = [];
  const subs = new Map(business.subscriptions.map((s) => [s.appId, s]));
  let anchorDay = business.anchorDay;
  const today = startOfNepalDay(now);

  const appName = (id: string) => catalog.apps[id]?.name?.en ?? id;
  const edName = (id: string, ed: string) => catalog.apps[id]?.editions[ed]?.name.en ?? ed;
  const label = (id: string, ed: string, extra = "") => ({ en: `${appName(id)} · ${edName(id, ed)}${extra}` });

  // The business's monthly cycle, from any monthly app still running (the anchor stays stable while one runs).
  const monthlyRunning = (exceptApp?: string) => business.subscriptions.some((s) => s.appId !== exceptApp && s.periodMonths === 1 && running(s, now));
  const cycle = () => {
    const a = anchorDay ?? anchorOf(now);
    const next = nextAnchor(now, a);
    return { next, prev: previousAnchor(now, a) };
  };

  if (!input.items.length) errors.push({ en: "The cart is empty." });
  const seen = new Set<string>();
  for (const item of input.items) {
    const key = item.kind === "addon" ? `addon:${item.addonKey}` : `app:${item.appId}`;
    if (seen.has(key)) { errors.push({ en: `${item.kind === "addon" ? item.addonKey : appName(item.appId)} is in the cart twice.` }); continue; }
    seen.add(key);

    if (item.kind === "subscribe" || item.kind === "change") {
      const app = catalog.apps[item.appId];
      const ed = app?.editions[item.editionId];
      if (!app || !ed) { errors.push({ en: `${appName(item.appId)}: that edition doesn't exist.` }); continue; }
      if (app.availability !== "live") { errors.push({ en: `${appName(item.appId)} is coming soon and can't be bought yet.` }); continue; }
      if (ed.free) { errors.push({ en: `${label(item.appId, item.editionId).en} is free: install it, there is nothing to pay.` }); continue; }
      const sub = subs.get(item.appId);
      const price = item.periodMonths === 12 ? ed.priceYearPaisa : item.periodMonths === 1 ? ed.priceMonthPaisa : null;
      if (price == null || !catalog.periods.includes(item.periodMonths)) { errors.push({ en: `${appName(item.appId)}: choose monthly or yearly.` }); continue; }
      const gross = Money.paisa(price);

      if (item.kind === "subscribe") {
        if (running(sub, now)) { errors.push({ en: `You already pay for ${appName(item.appId)}. Change its edition instead.` }); continue; }
        if (item.periodMonths === 12) {
          const end = addMonthsOnAnchor(now, 12, anchorOf(now));
          drafts.push({ kind: "subscription", appId: item.appId, editionId: item.editionId, description: label(item.appId, item.editionId, " · 1 year"), periodStart: today, periodEnd: end, periodMonths: 12, qty: 1, unitGrossPaisa: price, discountPaisa: 0, grossPaisa: price, saleType: "new" });
          continue;
        }
        if (monthlyRunning(item.appId) && anchorDay != null) {
          // Co-terming: join the business's monthly renewal date.
          const { next, prev } = cycle();
          const total = Math.max(nepalDays(prev, next), 1);
          const left = nepalDays(now, next);
          let end = next;
          let amount: Money;
          if (left < settings.minFirstPeriodDays) {
            end = addMonthsOnAnchor(next, 1, anchorDay);
            const nextTotal = Math.max(nepalDays(next, end), 1);
            amount = share(gross, left + nextTotal, nextTotal);
          } else amount = share(gross, left, total);
          notes.push({ en: `${appName(item.appId)} joins your monthly renewal on ${day(end)}.` });
          drafts.push({ kind: "subscription", appId: item.appId, editionId: item.editionId, description: label(item.appId, item.editionId, ` · until ${day(end)}`), periodStart: today, periodEnd: end, periodMonths: 1, qty: 1, unitGrossPaisa: price, discountPaisa: 0, grossPaisa: amount.paisa, saleType: "new" });
          continue;
        }
        // The first paid monthly app: today becomes the anchor.
        if (!monthlyRunning(item.appId)) anchorDay = anchorOf(now);
        const end = addMonthsOnAnchor(now, 1, anchorDay ?? anchorOf(now));
        drafts.push({ kind: "subscription", appId: item.appId, editionId: item.editionId, description: label(item.appId, item.editionId, " · 1 month"), periodStart: today, periodEnd: end, periodMonths: 1, qty: 1, unitGrossPaisa: price, discountPaisa: 0, grossPaisa: price, saleType: "new" });
        continue;
      }

      // change
      if (!running(sub, now) || !sub.currentPeriodStart || sub.periodMonths == null) { errors.push({ en: `${appName(item.appId)} has no paid period to change. Buy it instead.` }); continue; }
      const old = Money.paisa(sub.priceGrossPaisa);
      const { left, total } = periodDays(now, sub.currentPeriodStart, sub.currentPeriodEnd);
      if (sub.periodMonths === item.periodMonths) {
        if (item.editionId === sub.editionId) { errors.push({ en: `${appName(item.appId)} is already on ${edName(item.appId, item.editionId)}.` }); continue; }
        if (gross.compare(old) <= 0) {
          notes.push({ en: `${appName(item.appId)} moves to ${edName(item.appId, item.editionId)} on ${day(sub.currentPeriodEnd)}. Nothing to pay now.` });
          continue;
        }
        const u = upgrade(old, gross, left, total);
        const credit = u.charge.minus(u.due); // never more than the charge
        drafts.push({ kind: "subscription", appId: item.appId, editionId: item.editionId, description: label(item.appId, item.editionId, ` · ${left} of ${total} days`), periodStart: today, periodEnd: sub.currentPeriodEnd, periodMonths: sub.periodMonths, qty: 1, unitGrossPaisa: price, discountPaisa: 0, grossPaisa: u.charge.paisa, saleType: "upgrade" });
        drafts.push({ kind: "proration_credit", appId: item.appId, editionId: sub.editionId, description: { en: `Unused days of ${label(item.appId, sub.editionId).en}` }, periodStart: today, periodEnd: sub.currentPeriodEnd, periodMonths: sub.periodMonths, qty: 1, unitGrossPaisa: -credit.paisa, discountPaisa: 0, grossPaisa: -credit.paisa, saleType: "upgrade" });
        continue;
      }
      if (sub.periodMonths === 1 && item.periodMonths === 12) {
        const unused = share(old, left, total);
        const credit = unused.compare(gross) > 0 ? gross : unused;
        const end = addMonthsOnAnchor(now, 12, anchorOf(now));
        drafts.push({ kind: "subscription", appId: item.appId, editionId: item.editionId, description: label(item.appId, item.editionId, " · 1 year"), periodStart: today, periodEnd: end, periodMonths: 12, qty: 1, unitGrossPaisa: price, discountPaisa: 0, grossPaisa: price, saleType: "upgrade" });
        drafts.push({ kind: "proration_credit", appId: item.appId, editionId: sub.editionId, description: { en: `Unused days of ${label(item.appId, sub.editionId).en}` }, periodStart: today, periodEnd: sub.currentPeriodEnd, periodMonths: 1, qty: 1, unitGrossPaisa: -credit.paisa, discountPaisa: 0, grossPaisa: -credit.paisa, saleType: "upgrade" });
        continue;
      }
      notes.push({ en: `${appName(item.appId)} switches to ${item.periodMonths === 1 ? "monthly" : `${item.periodMonths} months`} on ${day(sub.currentPeriodEnd)}. Nothing to pay now.` });
      continue;
    }

    if (item.kind === "renew") {
      const sub = subs.get(item.appId);
      if (!sub || sub.periodMonths == null || sub.uninstalledAt) { errors.push({ en: `${appName(item.appId)} has nothing to renew.` }); continue; }
      const app = catalog.apps[item.appId];
      const st = effectiveStatus(sub, now, { freeEditionEnabled: app?.freeEditionEnabled ?? false, settings });
      // Paying in grace continues from the old end (no gap, no double); later, the new period starts today.
      const continues = !!sub.currentPeriodEnd && (st.status === "active" || st.status === "cancelled" || st.status === "past_due");
      const start = continues ? sub.currentPeriodEnd! : today;
      const months = sub.periodMonths;
      const end = addMonthsOnAnchor(start, months, months === 1 ? (anchorDay ?? anchorOf(start)) : anchorOf(start));
      drafts.push({ kind: "subscription", appId: item.appId, editionId: sub.editionId, description: label(item.appId, sub.editionId, ` · ${day(start)} to ${day(end)}`), periodStart: start, periodEnd: end, periodMonths: months, qty: 1, unitGrossPaisa: sub.priceGrossPaisa, discountPaisa: 0, grossPaisa: sub.priceGrossPaisa, saleType: "renewal" });
      continue;
    }

    // addon
    if (!Number.isSafeInteger(item.qty) || item.qty < 1) { errors.push({ en: "Choose how many to add." }); continue; }
    const def = catalog.addons.find((a) => a.key === item.addonKey && a.active);
    const builtIn = item.addonKey === "seats" ? catalog.business.seatAddon : item.addonKey === "storage" ? catalog.business.storageAddon : null;
    if (!def && !builtIn) { errors.push({ en: `The add-on ${item.addonKey} isn't sold.` }); continue; }
    const parentApp = def?.appId ?? null;
    let start: Date, end: Date;
    if (parentApp) {
      const parent = subs.get(parentApp);
      if (!running(parent, now) || !parent.currentPeriodStart) { errors.push({ en: `${def!.name.en} needs a paid ${appName(parentApp)}.` }); continue; }
      start = parent.currentPeriodStart; end = parent.currentPeriodEnd;
    } else {
      if (!monthlyRunning() || anchorDay == null) { errors.push({ en: `${def?.name.en ?? item.addonKey} needs a paid monthly app first.` }); continue; }
      const c = cycle();
      start = c.prev; end = c.next;
    }
    const unit = def?.priceMonthPaisa ?? builtIn!.priceMonthPaisa;
    const { left, total } = periodDays(now, start, end);
    const amount = share(Money.paisa(unit).times(item.qty), left, total);
    drafts.push({ kind: "addon", appId: parentApp, editionId: null, addonKey: item.addonKey, description: { en: `${def?.name.en ?? (item.addonKey === "seats" ? "Extra team seat" : "Extra storage")} × ${item.qty} · until ${day(end)}` }, periodStart: today, periodEnd: end, periodMonths: 1, qty: item.qty, unitGrossPaisa: unit, discountPaisa: 0, grossPaisa: amount.paisa, saleType: "addon" });
  }

  // One coupon, spread over the lines it applies to (before price protection, so protection compares the price really charged).
  let discount = Money.zero();
  if (input.coupon) {
    const c = input.coupon;
    const eligible = drafts.filter((d) => (d.kind === "subscription" || d.kind === "addon") && d.grossPaisa > 0);
    const firstPurchase = !business.subscriptions.some((s) => s.periodMonths != null);
    const lines = eligible.map((d) => ({ appId: d.appId, editionId: d.editionId, grossPaisa: d.grossPaisa }));
    const parts = couponDiscounts(c, lines);
    const eligibleGross = lines.reduce((a, l) => a + (couponApplies(c, l) ? l.grossPaisa : 0), 0);
    const why = checkCoupon(c, { now, firstPurchase, usesByBusiness: business.couponUsesByBusiness ?? 0, usesTotal: business.couponUsesTotal ?? 0, eligibleGrossPaisa: c.kind === "trial_days" ? 1 : eligibleGross });
    if (why) errors.push(why);
    else if (c.kind === "trial_days") notes.push({ en: `Code ${c.code}: ${c.value} more trial days.` });
    else {
      eligible.forEach((d, i) => { d.discountPaisa = parts[i]!.paisa; d.grossPaisa -= parts[i]!.paisa; });
      discount = parts.reduce((a, b) => a.plus(b), Money.zero());
    }
  }

  // Price protection: renewals of the apps the old plan covered never cost more than the old plan did.
  const lock = business.lock;
  const covered = drafts.filter((d) => d.saleType === "renewal" && d.appId && lock?.coversApps.includes(d.appId));
  if (covered.length && lock) {
    const months = covered[0]!.periodMonths ?? 1;
    const t = Money.paisa(covered.reduce((a, d) => a + d.grossPaisa, 0));
    const legacy = input.legacyTotalFor ? Money.paisa(input.legacyTotalFor(months)) : undefined;
    const off = priceProtection(lock, now, t, months, legacy);
    if (!off.isZero()) drafts.push({ kind: "price_protection", appId: null, editionId: null, description: { en: `Price protection until ${day(lock.lockEnd)}` }, periodStart: null, periodEnd: null, periodMonths: months, qty: 1, unitGrossPaisa: -off.paisa, discountPaisa: 0, grossPaisa: -off.paisa, saleType: "renewal" });
  }

  let total = Money.paisa(drafts.reduce((a, d) => a + d.grossPaisa, 0));
  if (total.isNegative()) { errors.push({ en: "This cart would come to less than zero." }); total = Money.zero(); }
  let carry = Money.zero();
  if (!total.isZero() && total.compare(Money.paisa(settings.minChargePaisa)) < 0 && drafts.every((d) => d.saleType === "upgrade" || d.saleType === "addon" || d.grossPaisa <= 0)) {
    carry = total;
    drafts.push({ kind: "carry", appId: null, editionId: null, description: { en: "Small amount moved to your next invoice" }, periodStart: null, periodEnd: null, periodMonths: null, qty: 1, unitGrossPaisa: -carry.paisa, discountPaisa: 0, grossPaisa: -carry.paisa, saleType: "upgrade" });
    notes.push({ en: `Rs ${carry.toString()} is below the minimum charge and is added to your next invoice.` });
    total = Money.zero();
  }

  // VAT once from the total; each line gets its own share and the biggest line takes the rounding difference.
  const split = total.splitVat(settings.vatRatePct);
  const vats = drafts.map((d) => Money.paisa(d.grossPaisa).splitVat(settings.vatRatePct).vat);
  const diff = split.vat.minus(vats.reduce((a, b) => a.plus(b), Money.zero()));
  if (!diff.isZero() && drafts.length) {
    let big = 0;
    drafts.forEach((d, i) => { if (d.grossPaisa > drafts[big]!.grossPaisa) big = i; });
    vats[big] = vats[big]!.plus(diff);
  }
  const lines: QuoteLine[] = drafts.map((d, i) => ({ ...d, vatPaisa: vats[i]!.paisa, netPaisa: d.grossPaisa - vats[i]!.paisa }));

  if (!settings.salesEnabled) warnings.push({ en: "Sales are switched off: this is a preview only." });
  return {
    lines, discountPaisa: discount.paisa, subtotalPaisa: split.subtotal.paisa, vatPaisa: split.vat.paisa, totalPaisa: total.paisa,
    carryPaisa: carry.paisa, anchorDay, dueAt: new Date(now.getTime() + settings.quoteHours * 3_600_000), notes, warnings, errors,
  };
}

// Kept for callers that only need a date for a trial end (P3-BE-6 uses it with the catalog's trialDays).
export const trialEnd = (now: Date, days: number): Date => addNepalDays(now, days);
