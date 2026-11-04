// Reviews from the website about the business and its listings, with public replies.
// Where it fits: the panel's Reviews page.
// How it works: lists reviews with the average and a star breakdown for the branches in view; a reply shows under the
// review on the website and the reviewer is notified.
// Rules: "reviews.reply" replies, "customers.view" can read; hiding a review is Sheetal's decision, not the business's.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { notify } from "@sheetal/backend-core/lib/notify";
import { branchView, inView, workspaceOf, type Workspace } from "../access.js";

export async function reviewRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const canRead = (ws: Workspace) => { if (!ws.can("reviews.reply") && !ws.can("customers.view")) throw forbidden("Your role can't see reviews."); };

  /** The business's reviews: of the business, and of its listings in the branches in view. */
  async function scope(ws: Workspace, request: Parameters<typeof workspaceOf>[0]) {
    const listings = await db().listing.findMany({ where: { tenantId: ws.tenantId, ...inView(await branchView(db(), request, ws)) }, select: { id: true, code: true, title: true, slug: true } });
    const where: Prisma.ReviewWhereInput = { status: "published", OR: [{ tenantId: ws.tenantId }, { listingId: { in: listings.map((l) => l.id) } }] };
    return { where, listings: new Map(listings.map((l) => [l.id, l])) };
  }

  app.get("/reviews", async (request) => {
    const ws = workspaceOf(request);
    canRead(ws);
    const q = z.object({ show: z.enum(["all", "unanswered", "low"]).default("all") }).parse(request.query);
    const { where, listings } = await scope(ws, request);
    const [rows, all] = await Promise.all([
      db().review.findMany({ where: { AND: [where, q.show === "unanswered" ? { reply: null } : q.show === "low" ? { rating: { lte: 2 } } : {}] }, orderBy: { createdAt: "desc" }, take: 300 }),
      db().review.findMany({ where, select: { rating: true, reply: true } }),
    ]);
    const people = new Map((await db().user.findMany({ where: { id: { in: [...rows.map((r) => r.userId), ...rows.map((r) => r.repliedBy).filter((x): x is string => !!x)] } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    return {
      data: rows.map((r) => {
        const l = r.listingId ? listings.get(r.listingId) : undefined;
        return {
          id: r.id, about: r.tenantId ? "business" : "listing", listing: l ? { code: l.code, title: l.title, link: `/property/${l.slug}` } : null,
          rating: r.rating, comment: r.comment, by: people.get(r.userId) ?? "Sheetal user", at: r.createdAt,
          reply: r.reply, repliedAt: r.repliedAt, repliedBy: r.repliedBy ? people.get(r.repliedBy) ?? null : null,
        };
      }),
      meta: {
        count: all.length, unanswered: all.filter((r) => !r.reply).length,
        average: all.length ? Math.round((all.reduce((s, r) => s + r.rating, 0) / all.length) * 10) / 10 : null,
        stars: [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: all.filter((r) => r.rating === n).length })),
        canReply: ws.can("reviews.reply"),
      },
    };
  });

  app.post<{ Params: { id: string } }>("/reviews/:id/reply", async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("reviews.reply")) throw forbidden("Your role can't reply to reviews.");
    const { text } = z.object({ text: z.string().trim().max(1500) }).parse(request.body);
    const { where, listings } = await scope(ws, request);
    const r = await db().review.findFirst({ where: { AND: [where, { id: request.params.id }] } });
    if (!r) throw notFound("Review not found.");
    // An empty reply takes the answer down.
    await db().review.update({ where: { id: r.id }, data: text ? { reply: text, repliedAt: new Date(), repliedBy: ws.user.id } : { reply: null, repliedAt: null, repliedBy: null } });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: text ? "review.replied" : "review.reply_removed", target: r.id, ip: request.ip } });
    if (text && !r.reply) {
      const l = r.listingId ? listings.get(r.listingId) : undefined;
      await notify(db(), [r.userId], { type: "review_reply", title: `${ws.member.tenant.name} replied to your review`, message: text.slice(0, 140), link: l ? `/property/${l.slug}` : `/agent/${ws.tenantId}` });
    }
    return { message: text ? "Reply posted. It shows under the review on the website." : "Reply removed." };
  });
}
