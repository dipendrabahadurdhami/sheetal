// How a review looks to the screen.
// Where it fits: the controller answers with these; moved from the old routes file (P1-BE-6). The JSON is the one the page already reads.
// How it works: `about` says business or listing; a listing review carries its code, title and public link; people are shown by user name.
// Rules: new field `version` (a whole number) is harmless: the new page sends it back when replying so a stale reply is refused (409).

import type { ListingBrief, ReviewRow } from "./types.js";

export function present(r: ReviewRow, listings: Map<number, ListingBrief>, people: Map<string, string>) {
  const l = r.listingId ? listings.get(r.listingId) : undefined;
  return {
    id: r.id, about: r.tenantId ? "business" : "listing", listing: l ? { code: l.code, title: l.title, link: `/property/${l.slug}` } : null,
    rating: r.rating, comment: r.comment, by: people.get(r.userId) ?? "Sheetal user", at: r.createdAt,
    reply: r.reply, repliedAt: r.repliedAt, repliedBy: r.repliedBy ? people.get(r.repliedBy) ?? null : null,
    version: r.version,
  };
}

/** The numbers above the list. */
export function summary(all: { rating: number; reply: string | null }[], canReply: boolean) {
  return {
    count: all.length, unanswered: all.filter((r) => !r.reply).length,
    average: all.length ? Math.round((all.reduce((s, r) => s + r.rating, 0) / all.length) * 10) / 10 : null,
    stars: [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: all.filter((r) => r.rating === n).length })),
    canReply,
  };
}
