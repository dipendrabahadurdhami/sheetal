// The Review row as the repository hands it out.
// Where it fits: the type parameter of ReviewRepository and ReviewService; the fields are the Prisma columns of model Review.
// How it works: a review is about a business (tenantId) OR about a listing (listingId), written by userId. It has no branch of its own.
// Rules: types only. `tenantId` is typed as a string because the kernel's BusinessEntity says so; in the table it is NULL for a review of a listing, and the
// repository never uses it as "the business" (its visibility rule is extraScope in review.repository.ts).

import type { BusinessEntity } from "@sheetal/platform/core/repository";

export interface ReviewRow extends BusinessEntity {
  userId: string; listingId: number | null; rating: number; comment: string; status: string;
  reply: string | null; repliedAt: Date | null; repliedBy: string | null;
}

/** What a reply changes (nothing else about a review is changed by the business). */
export interface ReviewChange { reply: string | null; repliedAt: Date | null; repliedBy: string | null }

/** The listing fields a review row needs to show (code, title, link). */
export interface ListingBrief { id: number; code: string | null; title: string; slug: string }
