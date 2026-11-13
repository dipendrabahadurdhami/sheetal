// The table code of the Workspace's growth tools: analytics (page views of the business's listings) and chat channels (connected WhatsApp, Messenger and
// Instagram accounts; ChannelAccount stays with Workspace, MODEL-OWNERS.md). Moved out of business/backend/src/modules/growth/routes.ts in P2-W6.
// Where it fits: GrowthService. Rules: every query carries this business.

import type { Prisma } from "@prisma/client";
import type { BusinessContext } from "@sheetal/platform/core/context";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;

export class GrowthRepository {
  planOf(ctx: BusinessContext) { return db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, include: { plan: true } }).then((t) => t.plan); }
  listingIdsInView(ctx: BusinessContext, branchIds: readonly string[]) {
    return db(ctx).listing.findMany({ where: { tenantId: ctx.business.id, branchId: { in: [...branchIds] } }, select: { id: true } }).then((r) => r.map((l) => l.id));
  }
  analytics(ctx: BusinessContext, since: Date, ids: number[] | null, branchIds: readonly string[] | null) {
    const t = ctx.business.id;
    const pv = { tenantId: t, createdAt: { gte: since }, ...(ids ? { listingId: { in: ids } } : {}) };
    return Promise.all([
      db(ctx).pageView.count({ where: pv }),
      db(ctx).pageView.groupBy({ by: ["session"], where: pv }).then((r) => r.length),
      db(ctx).pageView.groupBy({ by: ["listingId"], where: { ...pv, listingId: ids ? { in: ids } : { not: null } }, _count: true, orderBy: { _count: { listingId: "desc" } }, take: 20 }),
      db(ctx).lead.groupBy({ by: ["listingId"], where: { tenantId: t, createdAt: { gte: since }, ...(branchIds ? { branchId: { in: [...branchIds] } } : {}) }, _count: true }),
      db(ctx).$queryRaw<{ day: string; views: number; visitors: number }[]>`SELECT to_char(created_at AT TIME ZONE 'Asia/Kathmandu', 'YYYY-MM-DD') AS day, count(*)::int AS views, count(DISTINCT session)::int AS visitors FROM page_views WHERE tenant_id = ${t} AND created_at >= ${since} AND (${ids === null} OR listing_id = ANY(${ids ?? []}::int[])) GROUP BY 1 ORDER BY 1`,
    ]);
  }
  listingTitles(ctx: BusinessContext, ids: number[]) { return db(ctx).listing.findMany({ where: { id: { in: ids }, tenantId: ctx.business.id }, select: { id: true, code: true, title: true } }); }
  channels(ctx: BusinessContext) { return db(ctx).channelAccount.findMany({ where: { tenantId: ctx.business.id }, orderBy: { createdAt: "asc" } }); }
  channelByExternalId(ctx: BusinessContext, externalId: string) { return db(ctx).channelAccount.findUnique({ where: { externalId } }); }
  addChannel(ctx: BusinessContext, d: { kind: string; externalId: string; name: string; accessToken: string }) { return db(ctx).channelAccount.create({ data: { ...d, tenantId: ctx.business.id } }); }
  async removeChannel(ctx: BusinessContext, id: string) { return (await db(ctx).channelAccount.deleteMany({ where: { id, tenantId: ctx.business.id } })).count > 0; }
}
