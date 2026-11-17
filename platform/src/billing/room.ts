// The one place an app asks "is there room for one more?" under its edition's limit (MARKETPLACE-AND-BILLING.md section 6.3; wired into
// the apps on 17 Nov 2026: until then the catalog's free limits were shown and sold but checked nowhere).
// Where it fits: an app's service calls requireRoom() just before it adds a record: `await requireRoom(ctx, "hotel", "rooms", () => count)`.
// How it works: only a business on app subscriptions (entitlements.mode "apps") is checked, with the catalog's rule for that limit: a hard
// limit refuses at the number, a soft one (money-in: bills, invoices) allows 20% over first, null is unlimited. The refusal is the single
// 402 "limit_reached" answer the screens already turn into the upgrade panel. The count is asked for only when it is needed.
// Rules: a business still on Starter / Business / Pro, or on shadow, is NOT checked here: its plan's own checks stay exactly as they were.
// Records that arrive from the public (website leads, reviews, online bookings) are never refused by a limit: a customer is never lost
// (PHASE-3-RISKS A6); only what staff add in the panel is counted against it.

import type { BusinessContext } from "../core/context.js";

const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60_000;

/** True when this business's limits come from its app editions (so the plan's own checks are skipped). */
export const onApps = (ctx: Pick<BusinessContext, "entitlements">): boolean => ctx.entitlements.mode === "apps" && !!ctx.entitlements.requireLimit;

/** The first moment of the current calendar month in Nepal time, as a UTC date ("per month" limits count from here). */
export function monthStart(now: Date): Date {
  const local = new Date(now.getTime() + NEPAL_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - NEPAL_OFFSET_MS);
}

/**
 * Refuses (402 limit_reached) when `adding` more would pass the edition's limit of `appId` for `key`. Does nothing for a business that is
 * not on app subscriptions. `used` is called only when the business is checked.
 */
export async function requireRoom(ctx: Pick<BusinessContext, "entitlements">, appId: string, key: string, used: () => Promise<number> | number, adding = 1): Promise<void> {
  if (!onApps(ctx)) return;
  ctx.entitlements.requireLimit!(appId, key, { used: await used(), adding });
}

/** The limit as a plan-style number for screens that show "used of cap": -1 = unlimited. Null when the business is not on app subscriptions. */
export function editionCap(ctx: Pick<BusinessContext, "entitlements">, appId: string, key: string): number | null {
  if (!onApps(ctx)) return null;
  return ctx.entitlements.limit(appId, key) ?? -1;
}
