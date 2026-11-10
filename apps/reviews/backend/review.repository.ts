// The only code that reads and writes the reviews table for the business panel (KERNEL.md 10.7).
// Where it fits: ReviewService calls it. The website API still WRITES reviews (website/backend/src/modules/engage/routes.ts); this reads them for the business
// and writes only the business's reply.
// How it works: reviews have no branch and the business column is not the whole rule, so the standard tenant filter is OFF (tenantField: null) and extraScope carries
// the entire visibility rule: published, and either about this business OR about a listing of this business in the branches the person's data scope allows.
// Deleted rows are hidden by the base class (deletedAt). "hidden" is a status Sheetal sets; it stays out of this list too, as before (status must be "published").
// Rules: a missing or out-of-scope review answers "Review not found." Nothing here creates or deletes a review.

import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import { notFound } from "@sheetal/platform/core/errors";
import { BaseRepository } from "@sheetal/platform/core/repository";
import type { ListingBrief, ReviewChange, ReviewRow } from "./types.js";

type Where = Record<string, unknown>;

/** The few Prisma delegates read next to the reviews (looked up on the transaction when there is one). */
interface Tables {
  listing: { findMany(args: object): Promise<ListingBrief[]> };
  review: { findMany(args: object): Promise<{ rating: number; reply: string | null }[]> };
  user: { findMany(args: object): Promise<{ id: string; userName: string }[]> };
}
const tables = (ctx: BusinessContext): Tables => (ctx.tx ?? ctx.db) as unknown as Tables;

export class ReviewRepository extends BaseRepository<ReviewRow, never, ReviewChange> {
  constructor() {
    super({
      model: "review", tenantField: null, branchField: null, ownerField: null, label: "This review",
      filterable: { rating: ["eq", "lte", "gte"], reply: ["isNull"] },
      sortable: ["createdAt", "rating"],
      defaultSort: [{ field: "createdAt", dir: "desc" }],
      legacyMaxRows: 300,   // the page shows the newest 300, as before
    });
  }

  /** The business's listings in the person's branch view (the old inView()): with the fields a review row shows. */
  async listingsInView(ctx: BusinessContext, scope: DataScope): Promise<ListingBrief[]> {
    const ids = ctx.branches.idsFor(scope);
    return tables(ctx).listing.findMany({
      where: { tenantId: ctx.business.id, ...(ids ? { branchId: { in: [...ids] } } : {}) },
      select: { id: true, code: true, title: true, slug: true },
    });
  }

  /** The whole visibility rule (today's scope()): published, and of the business or of its listings in view. */
  protected override async extraScope(ctx: BusinessContext, scope: DataScope): Promise<Where> {
    const listings = await this.listingsInView(ctx, scope);
    return { status: "published", OR: [{ tenantId: ctx.business.id }, { listingId: { in: listings.map((l) => l.id) } }] };
  }

  override async get(ctx: BusinessContext, id: string, scope: DataScope, opts: { includeDeleted?: boolean } = {}): Promise<ReviewRow> {
    const row = await this.find(ctx, id.slice(0, 40), scope, opts);
    if (!row) throw notFound("Review not found.");
    return row;
  }

  /** Rating and reply of every visible review: the numbers above the list (count, unanswered, average, stars). */
  async ratings(ctx: BusinessContext, scope: DataScope): Promise<{ rating: number; reply: string | null }[]> {
    return tables(ctx).review.findMany({ where: await this.scopeWhere(ctx, scope), select: { rating: true, reply: true } });
  }

  /** Names of the people who wrote or answered reviews (user id -> user name). */
  async userNames(ctx: BusinessContext, ids: readonly string[]): Promise<Map<string, string>> {
    const rows = await tables(ctx).user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, userName: true } });
    return new Map(rows.map((u) => [u.id, u.userName]));
  }
}
