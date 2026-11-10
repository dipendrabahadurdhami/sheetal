// The event Reviews publishes: name and payload, as listed in app.manifest.ts (events.publishes).
// Where it fits: ReviewService publishes it inside the reply's transaction.
// How it works: one event, "reviews.review.replied", for a reply and for taking a reply down (hasReply says which).
// Rules: the payload is exactly the manifest's: { reviewId, hasReply }. Change it only by adding a version in the manifest first.

import type { ReviewRow } from "./types.js";

export const REVIEW_EVENTS = { replied: "reviews.review.replied" } as const;

export const repliedPayload = (r: ReviewRow) => ({ reviewId: r.id, hasReply: !!r.reply });
