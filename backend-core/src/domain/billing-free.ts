// Moving one business to the free tier now (the owner's rule, 16 Nov 2026): every paid thing it holds ends today, it keeps each app on its
// free edition, and its website listings follow the free Listings limit (listing-limit.ts). Nothing is deleted.
// Where it fits: backend-core/scripts/billing-free.ts is the command line (`npm run billing:free`). It is the staff answer to "this plan was
// never really paid" (a gift, a test, the old plan of a business that is to start again from free). The normal road is different: a paid
// period that runs out ends by itself through the lifecycle job, and the same listing rule then applies.
// How it works, in ONE transaction per business (only a business on billingMode "apps"):
//   subscriptions   an app with a free edition goes to it (active, no period, price 0); an app without one (Mail) becomes "expired";
//                   one event per changed subscription ("moved_to_free", actor staff);
//   grants          the migration's and "covered" grants (old limits, seats, monthly AI credits, whole-app) are revoked today; a gift or a
//                   staff grant is a decision of its own and stays;
//   add-ons         quantity 0; the price lock is removed;
//   the old plan    the business goes to its type's Starter plan with no renewal date, so every old screen says "free" too; the
//                   businesses it covered follow it (syncCovered);
//   audit           one row "billing.moved_to_free" holding what it had before (to put it back by hand if ever needed);
//   listings        reconcileInTx(): only as many published listings as the free edition allows stay on the website.
// Rules: refused while a payment is in flight, and for a business that PAID a subscription invoice whose period still runs (it bought that
// time; `force` overrides). Without `apply` it only says what would happen. AI credits already in the balance are not taken away.

import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import { SettingsService } from "@sheetal/platform/settings/service";
import { CATALOG_SETTING, withNewApps } from "@sheetal/platform/billing/catalog";
import { maskName } from "@sheetal/platform/billing/migrate-plan";
import type { Catalog } from "@sheetal/platform/billing/types";
import type { BusinessType } from "./permissions.js";
import { syncCovered } from "./billing.js";
import { listingLimitOf, reconcileInTx, type LimitResult } from "./listing-limit.js";
import { starterPlanId } from "./plans.js";

export interface FreeResult {
  id: string; masked: string; ok: boolean; changed: boolean; reason?: string;
  /** Apps that go from a paid edition to the free one, and apps that end because they have no free edition. */
  toFree: string[]; ended: string[];
  grantsRevoked: number; addonsEnded: number; lockRemoved: boolean; planBefore: string; planAfter: string;
  /** Published listings now, how many the free edition allows, how many would be (or were) paused. */
  published: number; listingLimit: number | null; listingsPaused: number;
  listings?: LimitResult;
}

const freeEditionOf = (catalog: Catalog, appId: string) => {
  const a = catalog.apps[appId];
  return a && a.freeEditionEnabled && a.editions.free?.free ? "free" : null;
};

export async function moveToFree(db: Db, o: { tenantId: string; apply?: boolean; force?: boolean; by?: string; now?: Date; catalog?: Catalog }): Promise<FreeResult> {
  const now = o.now ?? new Date();
  const catalog = o.catalog ?? withNewApps(await new SettingsService(db as never, { warn: () => undefined }).get(CATALOG_SETTING));
  const t = await db.tenant.findUnique({ where: { id: o.tenantId }, include: { plan: true } });
  const res: FreeResult = {
    id: o.tenantId, masked: t ? maskName(t.name, t.id) : `?? (${o.tenantId})`, ok: false, changed: false, toFree: [], ended: [], grantsRevoked: 0, addonsEnded: 0,
    lockRemoved: false, planBefore: t?.planId ?? "", planAfter: t ? starterPlanId(t.type as BusinessType) : "", published: 0, listingLimit: null, listingsPaused: 0,
  };
  if (!t) return { ...res, reason: "no such business" };
  if (t.billingMode !== "apps") return { ...res, reason: `it is on "${t.billingMode}": move it to apps first (npm run billing:mode)` };
  const [subs, grants, addons, lock, inFlight, paidRunning, published] = await Promise.all([
    db.subscription.findMany({ where: { tenantId: t.id, uninstalledAt: null }, orderBy: { appId: "asc" } }),
    db.entitlementGrant.findMany({ where: { tenantId: t.id, revokedAt: null, source: { in: ["migration", "covered"] }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { id: true, kind: true, appId: true, key: true, value: true, endsAt: true } }),
    db.addonSubscription.findMany({ where: { tenantId: t.id, OR: [{ qty: { gt: 0 } }, { renewQty: { gt: 0 } }] }, select: { id: true, addonKey: true, qty: true, renewQty: true } }),
    db.billingLock.findUnique({ where: { tenantId: t.id } }),
    db.payment.count({ where: { tenantId: t.id, status: { in: ["initiated", "pending_review"] } } }),
    db.subscription.count({ where: { tenantId: t.id, source: "purchase", status: { in: ["active", "past_due"] }, currentPeriodEnd: { gt: now } } }),
    db.listing.count({ where: { tenantId: t.id, deletedAt: null, status: "published" } }),
  ]);
  const paid = subs.filter((s) => s.editionId !== "free" && s.status !== "expired" && s.status !== "cancelled");
  res.toFree = paid.filter((s) => freeEditionOf(catalog, s.appId)).map((s) => s.appId);
  res.ended = paid.filter((s) => !freeEditionOf(catalog, s.appId)).map((s) => s.appId);
  res.grantsRevoked = grants.length; res.addonsEnded = addons.length; res.lockRemoved = !!lock; res.published = published;
  const freeListings = catalog.apps.listings?.editions.free?.limits.listings?.value;
  res.listingLimit = subs.some((s) => s.appId === "listings") ? (freeListings === undefined ? null : freeListings) : 0;
  res.listingsPaused = res.listingLimit === null ? 0 : Math.max(0, published - res.listingLimit);
  if (inFlight) return { ...res, reason: "a payment is in flight: wait until it is paid or fails" };
  if (paidRunning && !o.force) return { ...res, reason: `it paid for ${paidRunning} app(s) whose period still runs (force to end them anyway)` };
  const nothing = !paid.length && !grants.length && !addons.length && !lock && t.planId === res.planAfter;
  if (nothing && res.listingsPaused === 0) return { ...res, ok: true, reason: "already on the free tier" };
  res.ok = true;
  if (!o.apply) return res;

  res.listings = await db.$transaction(async (tx) => {
    for (const s of paid) {
      const free = freeEditionOf(catalog, s.appId);
      await tx.subscription.update({ where: { id: s.id }, data: free
        ? { editionId: "free", status: "active", periodMonths: null, priceGrossPaisa: 0n, listPriceGrossPaisa: 0n, currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, graceUntil: null, readOnlyFrom: null, cancelAtPeriodEnd: false, cancelledAt: null, pendingEditionId: null, pendingPeriodMonths: null, version: { increment: 1 } }
        : { status: "expired", periodMonths: null, currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, graceUntil: null, cancelAtPeriodEnd: false, pendingEditionId: null, pendingPeriodMonths: null, version: { increment: 1 } } });
      await tx.subscriptionEvent.create({ data: { subscriptionId: s.id, tenantId: t.id, appId: s.appId, type: "moved_to_free", fromStatus: s.status, toStatus: free ? "active" : "expired", fromEdition: s.editionId, toEdition: free ?? s.editionId, actorKind: "staff", reason: o.by ?? "script", at: now } });
    }
    if (grants.length) await tx.entitlementGrant.updateMany({ where: { id: { in: grants.map((g) => g.id) } }, data: { revokedAt: now } });
    if (addons.length) await tx.addonSubscription.updateMany({ where: { id: { in: addons.map((a) => a.id) } }, data: { qty: 0, renewQty: 0 } });
    if (lock) await tx.billingLock.delete({ where: { tenantId: t.id } });
    if (t.planId !== res.planAfter || t.renewsAt || t.graceUntil) {
      await tx.tenant.update({ where: { id: t.id }, data: { planId: res.planAfter, period: 1, renewsAt: null, graceUntil: null, remindedFor: null, ...(t.status === "past_due" ? { status: "active" } : {}) } });
      await syncCovered(tx, t.id);
    }
    await tx.auditLog.create({ data: {
      actorId: null, tenantId: t.id, action: "billing.moved_to_free", target: `${t.planId} -> ${res.planAfter}`, createdAt: now,
      meta: {
        by: o.by ?? "script", forced: !!o.force, planBefore: t.planId, periodBefore: t.period, renewsAtBefore: t.renewsAt?.toISOString() ?? null,
        subscriptions: paid.map((s) => ({ appId: s.appId, editionId: s.editionId, status: s.status, periodMonths: s.periodMonths, priceGrossPaisa: Number(s.priceGrossPaisa), currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null, currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null })),
        grants: grants.map((g) => ({ ...g, endsAt: g.endsAt?.toISOString() ?? null })), addons,
        lock: lock ? { legacyMonthlyGrossPaisa: Number(lock.legacyMonthlyGrossPaisa), legacyPeriodMonths: lock.legacyPeriodMonths, coversApps: lock.coversApps, lockEnd: lock.lockEnd.toISOString(), migrationRunId: lock.migrationRunId } : null,
      } as Prisma.InputJsonValue,
    } });
    // The limit as the business now has it (after the rows above), then the listings.
    const limit = await listingLimitOf(tx as unknown as Db, t.id, now);
    return reconcileInTx(tx, t.id, limit, now);
  }, { timeout: 180_000, maxWait: 20_000 });
  res.changed = true;
  res.listingLimit = res.listings.limit; res.listingsPaused = res.listings.paused;
  return res;
}
