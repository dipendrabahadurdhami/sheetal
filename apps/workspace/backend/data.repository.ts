// The only code of Import / Export that reads and writes tables (KERNEL.md section 6). Moved out of business/backend/src/modules/data/routes.ts in P2-W6
// (Workspace part 2).
// Where it fits: DataService calls these; an import runs in its transaction.
// How it works: exports read the rows of listings, leads, rooms, bookings or team members over the branches in view (`inView`). Two agreed cross-app
// writes (MODEL-OWNERS.md): an import adds listings as drafts (the Listings app's table) or leads (the CRM app's table), in the same transaction as its
// audit line and event. A listing import is written in two statements whatever its size (one insert, one update giving each listing its code and
// slug), so 2,000 rows stay well inside one transaction.
// Rules: every query carries this business.

import { Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext } from "@sheetal/platform/core/context";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { COUNTED } from "@sheetal/backend-core/domain/listings";
import { listingCode, prefixFor } from "@sheetal/backend-core/domain/codes";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
export type InView = { branchId?: { in: string[] } };

export class DataRepository {
  // ───── Exports ─────
  listings(ctx: BusinessContext, inView: InView) { return db(ctx).listing.findMany({ where: { tenantId: ctx.business.id, ...inView, status: { not: "removed" } }, orderBy: { createdAt: "desc" }, take: 10_000 }); }
  leads(ctx: BusinessContext, inView: InView) { return db(ctx).lead.findMany({ where: { tenantId: ctx.business.id, ...inView }, orderBy: { createdAt: "desc" }, take: 10_000 }); }
  listingCodes(ctx: BusinessContext, ids: number[]) { return db(ctx).listing.findMany({ where: { id: { in: ids }, tenantId: ctx.business.id }, select: { id: true, code: true } }); }
  rooms(ctx: BusinessContext, inView: InView) { return db(ctx).room.findMany({ where: { tenantId: ctx.business.id, ...inView, active: true }, orderBy: { no: "asc" } }); }
  bookings(ctx: BusinessContext, inView: InView) { return db(ctx).booking.findMany({ where: { tenantId: ctx.business.id, ...inView }, include: { room: { select: { no: true } } }, orderBy: { checkIn: "desc" }, take: 10_000 }); }
  team(ctx: BusinessContext) { return db(ctx).membership.findMany({ where: { tenantId: ctx.business.id, status: { in: ["active", "paused"] } }, include: { user: true, role: true }, orderBy: { createdAt: "asc" } }); }

  // ───── Imports ─────
  tenant(ctx: BusinessContext) { return db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, include: { plan: true } }); }
  planWithAddons<P extends { price: number; limits: unknown }>(ctx: BusinessContext, plan: P) { return effectiveLimits(db(ctx) as never, ctx.business.id, plan); }
  countedListings(ctx: BusinessContext) { return db(ctx).listing.count({ where: { tenantId: ctx.business.id, status: { in: COUNTED } } }); }
  listingsByCode(ctx: BusinessContext, inView: InView, codes: string[]) {
    return db(ctx).listing.findMany({ where: { tenantId: ctx.business.id, code: { in: codes }, ...inView }, select: { id: true, code: true, branchId: true } });
  }
  /** Adds the listings as drafts, then gives each its code (the business prefix and its number) and slug. Returns how many. */
  async addListingDrafts(ctx: BusinessContext, rows: (Omit<Prisma.ListingCreateManyInput, "code" | "slug" | "tenantId" | "createdBy" | "updatedBy"> & { slugBase: string })[]) {
    const me = actorIdOf(ctx);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const made = await db(ctx).listing.createManyAndReturn({
      data: rows.map(({ slugBase: _s, ...r }, i) => ({ ...r, code: `tmp-${stamp}-${i}`, slug: `tmp-${stamp}-${i}`, tenantId: ctx.business.id, createdBy: me, updatedBy: me })),
      select: { id: true, code: true },
    });
    const prefix = await prefixFor(db(ctx), ctx.business.id);
    const byTmp = new Map(rows.map((r, i) => [`tmp-${stamp}-${i}`, r.slugBase]));
    const values = made.map((l) => Prisma.sql`(${l.id}::int, ${listingCode(prefix, l.id)}, ${`${byTmp.get(l.code)}-${l.id}`})`);
    if (values.length) await db(ctx).$executeRaw`UPDATE "listings" AS l SET "code" = v.code, "slug" = v.slug FROM (VALUES ${Prisma.join(values)}) AS v(id, code, slug) WHERE l.id = v.id AND l.tenant_id = ${ctx.business.id}`;
    return made.length;
  }
  addLeads(ctx: BusinessContext, rows: Omit<Prisma.LeadCreateManyInput, "tenantId">[]) { return db(ctx).lead.createMany({ data: rows.map((r) => ({ ...r, tenantId: ctx.business.id })) }); }
}
