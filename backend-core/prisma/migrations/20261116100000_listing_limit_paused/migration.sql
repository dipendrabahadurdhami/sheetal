-- Listings over a business's limit (16 Nov 2026, the owner's rule): when a business falls to an edition with a smaller Listings limit, only
-- that many stay on the website; the others are paused, not deleted, and come back by themselves when the limit rises again.
-- Additive: one nullable column. It marks the listings the SYSTEM paused, so a listing a person paused or never published is never shown
-- by the system (backend-core/src/domain/listing-limit.ts).
ALTER TABLE "listings" ADD COLUMN "limit_paused_at" TIMESTAMP(3);
