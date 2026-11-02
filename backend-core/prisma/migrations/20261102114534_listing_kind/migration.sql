-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'sell';

-- CreateIndex
CREATE INDEX "listings_status_kind_published_at_idx" ON "listings"("status", "kind", "published_at");

-- Existing listings: rentals are "rentout", everything else stays "sell" until re-sorted.
UPDATE "listings" SET "kind" = 'rentout' WHERE "purpose" = 'rent';
