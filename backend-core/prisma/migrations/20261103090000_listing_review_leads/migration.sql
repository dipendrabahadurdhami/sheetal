-- New listing states for business actions and Sheetal's review
ALTER TYPE "ListingStatus" ADD VALUE 'paused';
ALTER TYPE "ListingStatus" ADD VALUE 'rejected';
ALTER TYPE "ListingStatus" ADD VALUE 'archived';

-- AlterTable
ALTER TABLE "listings" ADD COLUMN "submitted_at" TIMESTAMP(3),
ADD COLUMN "reviewed_at" TIMESTAMP(3),
ADD COLUMN "reviewed_by" TEXT,
ADD COLUMN "review_note" TEXT;

-- Listings already waiting count as sent for review when they were posted
UPDATE "listings" SET "submitted_at" = "created_at" WHERE "status" = 'pending';

-- CreateIndex
CREATE INDEX "listings_status_submitted_at_idx" ON "listings"("status", "submitted_at");

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "assignee_id" TEXT,
ADD COLUMN "follow_at" TIMESTAMP(3),
ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "value" BIGINT,
ADD COLUMN "read_at" TIMESTAMP(3),
ADD COLUMN "last_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "leads" SET "last_at" = "created_at", "status" = CASE WHEN "status" = 'closed' THEN 'won' ELSE "status" END;

-- CreateTable
CREATE TABLE "lead_messages" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_tenant_id_last_at_idx" ON "leads"("tenant_id", "last_at");

-- CreateIndex
CREATE INDEX "lead_messages_lead_id_created_at_idx" ON "lead_messages"("lead_id", "created_at");

-- AddForeignKey
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
