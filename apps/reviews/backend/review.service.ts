// The rules of Reviews (KERNEL.md 10.7): the list the page shows, and the reply.
// Where it fits: ReviewController calls these; they call ReviewRepository. Reviews are WRITTEN by the website API, so this service has no create or delete.
// How it works: overview() = permission, input, the visible reviews (repository), the people's names, the numbers above the list. reply() is one action: the
// permission, then in ONE transaction the reply on the row, the audit line ("review.replied" or "review.reply_removed", target = the review id) and the event
// "reviews.review.replied". The reviewer's notification is sent right after the transaction commits (a failed notification never undoes the reply).
// Rules: reading needs reviews.review.read, replying reviews.review.reply; a role that still holds the old names (customers.view, reviews.reply) passes through
// the alias layer. An empty text takes the reply down. `version` is optional: a stale one answers 409, a missing one saves as today.

import { z } from "zod";
import { versionConflict } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseService } from "@sheetal/platform/core/service";
import { notify } from "@sheetal/platform/notify/index";
import { REVIEW_EVENTS, repliedPayload } from "./events.js";
import { present, summary } from "./presenter.js";
import { ReviewRepository } from "./review.repository.js";
import { ListQuery, ReplyBody, versionIn } from "./schemas.js";
import type { ReviewChange, ReviewRow } from "./types.js";

export interface ReviewServiceDeps { bus: EventBus }

/** What reply() hands back: the row as saved, whether it had a reply before, and where the reviewer's notification should lead. */
export interface ReplyResult { row: ReviewRow; hadReply: boolean; link: string }

const READ = "reviews.review.read";
const REPLY = "reviews.review.reply";

export class ReviewService extends BaseService<ReviewRow, never, ReviewChange> {
  constructor(deps: ReviewServiceDeps) {
    super({
      app: "reviews", resource: "review", repo: new ReviewRepository(),
      // Only reading and replying exist; create/update/delete are not offered by any route (the website writes reviews).
      permissions: { read: READ, create: REPLY, update: REPLY, delete: REPLY },
      schemas: { create: z.never(), update: z.object({ reply: z.string().nullable(), repliedAt: z.date().nullable(), repliedBy: z.string().nullable() }) },
      audit: { entity: "review", label: (r) => r.id, actions: { updated: "review.replied" } },
      bus: deps.bus,
      requireVersion: false,
    });
  }

  private get reviews(): ReviewRepository { return this.deps.repo as ReviewRepository; }

  // ───── The list ─────

  async overview(ctx: BusinessContext, rawQuery: unknown) {
    this.requireApp(ctx);
    // Whoever may reply may also read (as today: "reviews.reply or customers.view can read"); a new role holding only
    // reviews.review.reply must see what it answers (Lead, after the first CI run of P1-BE-6).
    const scope = ctx.permissions.scopeOf(READ) ?? ctx.permissions.require(REPLY, "Your role can't see reviews.");
    const q = ListQuery.parse(rawQuery);
    const filters = q.show === "unanswered" ? [{ field: "reply", op: "isNull" as const, value: true }]
      : q.show === "low" ? [{ field: "rating", op: "lte" as const, value: 2 }] : [];
    const [page, all, listings] = await Promise.all([
      this.reviews.list(ctx, scope, { filters }),
      this.reviews.ratings(ctx, scope),
      this.reviews.listingsInView(ctx, scope),
    ]);
    const people = await this.reviews.userNames(ctx, [...page.rows.map((r) => r.userId), ...page.rows.map((r) => r.repliedBy).filter((x): x is string => !!x)]);
    const byId = new Map(listings.map((l) => [l.id, l]));
    // `meta.can` (P1-BE-7): what this person may do, so the screen stops guessing. `canReply` stays for the pages that read it.
    return { rows: page.rows.map((r) => present(r, byId, people)), meta: { ...summary(all, ctx.permissions.can(REPLY)), can: { reply: ctx.permissions.can(REPLY) } } };
  }

  // ───── Reply (or take the reply down) ─────

  async reply(ctx: BusinessContext, id: string, raw: unknown): Promise<{ text: string; posted: boolean }> {
    const done = await this.action<ReplyResult & { text: string }>(ctx, {
      name: "reply", permission: REPLY,
      audit: (r) => ({ action: r.text ? "review.replied" : "review.reply_removed", target: r.row.id }),
      event: (r) => ({ name: REVIEW_EVENTS.replied, payload: repliedPayload(r.row) }),
      run: async (tx, scope) => {
        const { text } = ReplyBody.parse(raw);
        const version = versionIn(raw);
        const current = await this.reviews.get(tx, id, scope);
        if (version !== undefined && version !== current.version) throw versionConflict("This review");
        const change: ReviewChange = text ? { reply: text, repliedAt: tx.now, repliedBy: tx.member.userId } : { reply: null, repliedAt: null, repliedBy: null };
        const row = await this.reviews.update(tx, id, change, scope, version);
        const listing = current.listingId ? (await this.reviews.listingsInView(tx, scope)).find((l) => l.id === current.listingId) : undefined;
        return { row, hadReply: !!current.reply, link: listing ? `/property/${listing.slug}` : `/agent/${ctx.business.id}`, text };
      },
    });
    // The first reply tells the reviewer; changing or removing a reply does not (as before). Sent after the commit.
    if (done.text && !done.hadReply) {
      // The reply is already saved: a failed notification is logged, never turned into an error for a reply that was posted (QA, P1-BE-6 fix 1).
      await notify(ctx.db, [done.row.userId], { type: "review_reply", title: `${ctx.business.name} replied to your review`, message: done.text.slice(0, 140), link: done.link })
        .catch((err: unknown) => ctx.log.warn({ err, reviewId: done.row.id }, "review reply notification failed"));
    }
    return { text: done.text, posted: !!done.text };
  }
}
