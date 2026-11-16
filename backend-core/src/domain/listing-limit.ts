// Listings and the Listings limit of a business on app subscriptions (the owner's rule, 16 Nov 2026).
// The rule: a business shows on the website only as many listings as its Listings edition allows (free: 3). When it falls to a smaller
// limit (its paid period ends, or staff move it to the free tier) the extra ones are PAUSED: off the website, still in the business panel,
// nothing deleted. When the limit rises again (it pays) exactly those come back by themselves. A listing that was not on the website before
// (a draft, one the business paused or archived, one in review) is never shown by this: the two sets are kept apart by `limitPausedAt`.
// Where it fits: the admin API's hourly job (admin/backend/src/jobs.ts) runs reconcileAllListingLimits() after the subscription lifecycle;
// the staff tool that moves a business to the free tier (billing-free.ts) calls reconcileListingLimit() at once.
// How it works, per business, in one transaction:
//   over the limit   keep the first `limit` published listings (featured first, then the newest published) and pause the rest with
//                    limitPausedAt = now;
//   room again       show the listings this paused before (newest published first) until the limit is reached (all of them when the
//                    limit is "unlimited"), and clear their mark;
//   tidy             a marked listing whose status a person changed since (sold, archived, draft, …) loses its mark and is left alone.
// Rules: only status "published" is ever paused (sold and rented listings stay as history). Only businesses on billingMode "apps" are
// touched: a business still on Starter / Business / Pro keeps today's behaviour. Nothing is deleted, no review state is changed.

import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import { loadEntitlementsV3 } from "@sheetal/platform/billing/load";
import { countSeats } from "@sheetal/platform/tenancy/context";

type Tx = Prisma.TransactionClient;
const quiet = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return quiet; }, level: "silent", silent() {} } as never;

export interface LimitResult { tenantId: string; limit: number | null; published: number; paused: number; restored: number; stillPaused: number }

/** Which published listings stay on the website when there is room for only some: featured first, then the newest published. */
const KEEP_ORDER: Prisma.ListingOrderByWithRelationInput[] = [{ featured: "desc" }, { publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }];

/** Brings one business's website listings in line with `limit` (null = unlimited) inside `tx`. */
export async function reconcileInTx(tx: Tx, tenantId: string, limit: number | null, now: Date): Promise<LimitResult> {
  const mine = { tenantId, deletedAt: null };
  // Tidy: a person changed a listing the system had paused; it is theirs again.
  await tx.listing.updateMany({ where: { ...mine, limitPausedAt: { not: null }, status: { not: "paused" } }, data: { limitPausedAt: null } });
  const published = await tx.listing.count({ where: { ...mine, status: "published" } });
  let paused = 0, restored = 0;
  if (limit !== null && published > limit) {
    const keep = await tx.listing.findMany({ where: { ...mine, status: "published" }, orderBy: KEEP_ORDER, take: limit, select: { id: true } });
    const r = await tx.listing.updateMany({ where: { ...mine, status: "published", id: { notIn: keep.map((l) => l.id) } }, data: { status: "paused", limitPausedAt: now } });
    paused = r.count;
  } else {
    const room = limit === null ? undefined : limit - published;
    if (room === undefined || room > 0) {
      const back = await tx.listing.findMany({ where: { ...mine, status: "paused", limitPausedAt: { not: null } }, orderBy: KEEP_ORDER, take: room, select: { id: true } });
      // In chunks: a business can have thousands (a single IN list has a parameter limit).
      for (let i = 0; i < back.length; i += 5000) {
        const r = await tx.listing.updateMany({ where: { id: { in: back.slice(i, i + 5000).map((l) => l.id) }, status: "paused" }, data: { status: "published", limitPausedAt: null } });
        restored += r.count;
      }
    }
  }
  const stillPaused = await tx.listing.count({ where: { ...mine, status: "paused", limitPausedAt: { not: null } } });
  if (paused || restored) {
    await tx.auditLog.create({ data: {
      actorId: null, tenantId, action: paused ? "listings.limit_paused" : "listings.limit_restored", target: String(paused || restored), createdAt: now,
      meta: { limit, publishedBefore: published, paused, restored, stillPaused } as Prisma.InputJsonValue,
    } });
  }
  return { tenantId, limit, published: published - paused + restored, paused, restored, stillPaused };
}

/** The Listings limit the business has now, from its app subscriptions: null = unlimited; 0 when it does not have the Listings app at all. */
export async function listingLimitOf(db: Db, tenantId: string, now: Date): Promise<number | null> {
  const ent = await loadEntitlementsV3(db, quiet, tenantId, now, await countSeats(db, tenantId, now));
  if (!ent.hasApp("listings")) return 0;
  return ent.limit("listings", "listings");
}

/** One business on "apps": its limit, then the reconcile, in one transaction. A business on plans or shadow is left alone (null). */
export async function reconcileListingLimit(db: Db, tenantId: string, o: { now?: Date } = {}): Promise<LimitResult | null> {
  const now = o.now ?? new Date();
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { billingMode: true } });
  if (!t || t.billingMode !== "apps") return null;
  const limit = await listingLimitOf(db, tenantId, now);
  return db.$transaction((tx) => reconcileInTx(tx, tenantId, limit, now), { timeout: 120_000, maxWait: 20_000 });
}

/** Every business on "apps" (the hourly job). One failing business never stops the others. */
export async function reconcileAllListingLimits(db: Db, o: { now?: Date; log?: { warn(o: object, msg?: string): void } } = {}): Promise<{ businesses: number; paused: number; restored: number }> {
  const out = { businesses: 0, paused: 0, restored: 0 };
  const tenants = await db.tenant.findMany({ where: { billingMode: "apps" }, select: { id: true } });
  for (const t of tenants) {
    try {
      const r = await reconcileListingLimit(db, t.id, o);
      if (r) { out.businesses++; out.paused += r.paused; out.restored += r.restored; }
    } catch (e) {
      o.log?.warn({ err: e, tenantId: t.id }, "listing limit: could not reconcile");
    }
  }
  return out;
}
