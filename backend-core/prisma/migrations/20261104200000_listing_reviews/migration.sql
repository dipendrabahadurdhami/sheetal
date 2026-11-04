-- Listing check-ups per branch: reviews by day, changes held off the website until decided.
ALTER TABLE "listings" ADD COLUMN "review_hold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "listings" ADD COLUMN "review_conflict" JSONB;
CREATE TABLE "listing_reviews" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "branch_id" TEXT,
  "listing_id" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "changes" JSONB NOT NULL DEFAULT '{}',
  "decided" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listing_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "listing_reviews_tenant_id_day_idx" ON "listing_reviews"("tenant_id", "day");
CREATE INDEX "listing_reviews_listing_id_day_idx" ON "listing_reviews"("listing_id", "day");
CREATE INDEX "listing_reviews_user_id_day_idx" ON "listing_reviews"("user_id", "day");
CREATE INDEX "listing_reviews_tenant_id_action_decided_idx" ON "listing_reviews"("tenant_id", "action", "decided");
