// The only code of the online travel sites that reads and writes their tables directly (KERNEL.md section 6); the request steps themselves
// (ask, answer, stop) are the shared backend-core helpers the admin side uses too, run with the service's transaction.
// Where it fits: OtaService. Moved in P2-W6 from business/backend/src/modules/growth/routes.ts and modules/ota/routes.ts.
// Rules: every query carries this business, except the public iCal link, which is for the business named in its signed link.

import type { Prisma } from "@prisma/client";
import type { BusinessContext } from "@sheetal/platform/core/context";

type Tx = Prisma.TransactionClient;
const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;

export class OtaRepository {
  feedsAndTypes(ctx: BusinessContext) {
    const t = ctx.business.id;
    return Promise.all([db(ctx).otaFeed.findMany({ where: { tenantId: t }, orderBy: { createdAt: "asc" } }), db(ctx).room.groupBy({ by: ["type"], where: { tenantId: t, active: true } })]);
  }
  activeRoomsOfType(ctx: BusinessContext, type: string) { return db(ctx).room.count({ where: { tenantId: ctx.business.id, type, active: true } }); }
  addFeed(ctx: BusinessContext, d: { roomType: string; site: string; url: string }) { return db(ctx).otaFeed.create({ data: { ...d, tenantId: ctx.business.id } }); }
  feed(ctx: BusinessContext, id: string) { return db(ctx).otaFeed.findFirst({ where: { id, tenantId: ctx.business.id } }); }
  /** For the public iCal link of one business's room type. */
  async busy(d: Tx, tenantId: string, type: string, from: Date) {
    const [perBranch, closedDays, stays] = await Promise.all([
      d.room.groupBy({ by: ["branchId"], where: { tenantId, type, active: true }, _count: true }),
      d.rateDay.findMany({ where: { tenantId, roomType: type, closed: true, day: { gte: from } }, select: { branchId: true, day: true } }),
      d.booking.findMany({ where: { tenantId, roomType: type, status: { in: ["requested", "confirmed", "checked_in"] }, checkOut: { gt: new Date() } }, select: { checkIn: true, checkOut: true } }),
    ]);
    return { perBranch, closedDays, stays };
  }
  requests(ctx: BusinessContext, inView: { branchId?: { in: string[] } }, listingId?: number) {
    return db(ctx).otaRequest.findMany({ where: { tenantId: ctx.business.id, ...inView, ...(listingId ? { listingId } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
  }
  listingTitles(ctx: BusinessContext, ids: number[]) { return db(ctx).listing.findMany({ where: { id: { in: ids }, tenantId: ctx.business.id }, select: { id: true, title: true, code: true } }); }
}
