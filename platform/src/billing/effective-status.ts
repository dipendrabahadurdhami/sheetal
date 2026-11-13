// The status and access of a subscription at a moment, worked out from its dates (MB sections 5.1, 5.5 and 7.2; rule 7: "dates decide,
// jobs announce").
// Where it fits: entitlements v3 (P3-BE-3) asks this for every app; the lifecycle job (P3-BE-5) compares it with the stored status to know
// which history row and mail are due. A late job therefore never gives free access and never takes access away early.
// How it works: from the stored row, the catalog's freeEditionEnabled and the day counts in the billing settings:
//   free edition                               -> active, full
//   trial until trialEndsAt                    -> trialing, full;   after: the free edition (limited) or locked
//   paid until currentPeriodEnd                -> active (or cancelled when the owner cancelled), full
//   + graceDays unpaid                         -> past_due, full (cancelled ones skip this and expire at the period end)
//   then, with a free edition                  -> expired on the free edition, limited
//   then, without one                          -> read_only for readOnlyDays, then expired, locked
//   uninstalled                                -> none
// Rules: pure (no clock, no database). Day counts are Nepal days from the period end. The stored status is only a hint for staff lists.

import { addNepalDays } from "./days.js";
import type { AccessMode, BillingSettings, SubscriptionState, SubscriptionStatus } from "./types.js";

export interface EffectiveStatus {
  status: SubscriptionStatus;
  access: AccessMode;
  /** The edition whose limits and features apply now: the paid one, the trial one, or "free" after a fall-back. null when locked or none. */
  edition: string | null;
  /** When this state ends by itself (the next date that changes the answer), or null. */
  until: Date | null;
}

type Days = Pick<BillingSettings, "graceDays" | "readOnlyDays">;

/** After a paid or trial period ends with nothing paid: the free edition if the app has one, otherwise locked. */
function fallBack(freeEditionEnabled: boolean): EffectiveStatus {
  return freeEditionEnabled
    ? { status: "expired", access: "limited", edition: "free", until: null }
    : { status: "expired", access: "locked", edition: null, until: null };
}

export function effectiveStatus(sub: SubscriptionState, now: Date, o: { freeEditionEnabled: boolean; settings: Days }): EffectiveStatus {
  if (sub.uninstalledAt && sub.uninstalledAt <= now) return { status: sub.status, access: "none", edition: null, until: null };
  const t = now.getTime();

  // Free edition: free forever, no dates.
  if (sub.periodMonths == null && sub.status !== "trialing") {
    if (sub.editionId === "free") return { status: "active", access: "full", edition: "free", until: null };
    // A paid edition without a period (should not happen; a CHECK keeps a period end on paid rows): treat as ended.
    return fallBack(o.freeEditionEnabled);
  }

  // Trial: the paid edition, free, until trialEndsAt.
  if (sub.status === "trialing" && sub.periodMonths == null) {
    if (sub.trialEndsAt && t < sub.trialEndsAt.getTime()) return { status: "trialing", access: "full", edition: sub.editionId, until: sub.trialEndsAt };
    return fallBack(o.freeEditionEnabled);
  }

  const end = sub.currentPeriodEnd;
  if (!end) return fallBack(o.freeEditionEnabled);
  if (t < end.getTime()) {
    const cancelled = sub.status === "cancelled" || sub.cancelAtPeriodEnd;
    return { status: cancelled ? "cancelled" : "active", access: "full", edition: sub.editionId, until: end };
  }
  // The owner cancelled: no renewal is expected, so no grace either.
  if (sub.status === "cancelled" || sub.cancelAtPeriodEnd) return fallBack(o.freeEditionEnabled);

  const graceEnd = addNepalDays(end, o.settings.graceDays);
  if (t < graceEnd.getTime()) return { status: "past_due", access: "full", edition: sub.editionId, until: graceEnd };
  if (o.freeEditionEnabled) return fallBack(true);
  const readOnlyEnd = addNepalDays(graceEnd, o.settings.readOnlyDays);
  if (t < readOnlyEnd.getTime()) return { status: "read_only", access: "read_only", edition: sub.editionId, until: readOnlyEnd };
  return fallBack(false);
}

/** What each access mode allows (MB section 7.2). */
export const ACCESS_RULES: Readonly<Record<AccessMode, { read: boolean; edit: boolean; create: boolean; publicLeads: boolean; paidBookings: boolean }>> = Object.freeze({
  full: { read: true, edit: true, create: true, publicLeads: true, paidBookings: true },
  limited: { read: true, edit: true, create: true, publicLeads: true, paidBookings: true },
  read_only: { read: true, edit: false, create: false, publicLeads: true, paidBookings: false },
  locked: { read: false, edit: false, create: false, publicLeads: true, paidBookings: false },
  none: { read: false, edit: false, create: false, publicLeads: false, paidBookings: false },
});

/** Background jobs only work for businesses whose app is in full or limited access (MB section 7.2); others are skipped and logged. */
export const jobMayRun = (access: AccessMode): boolean => access === "full" || access === "limited";
