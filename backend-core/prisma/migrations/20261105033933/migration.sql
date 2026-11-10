-- AlterTable
ALTER TABLE "rent_leases" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "rent_payments" ADD COLUMN     "collected_by" TEXT NOT NULL DEFAULT 'business',
ADD COLUMN     "proof_file" TEXT,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'staff',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'confirmed',
ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "rent_units" ADD COLUMN     "listing_id" INTEGER;

-- CreateIndex
CREATE INDEX "rent_leases_user_id_idx" ON "rent_leases"("user_id");

-- CreateIndex
CREATE INDEX "rent_payments_status_collected_by_idx" ON "rent_payments"("status", "collected_by");

-- CreateIndex
CREATE INDEX "rent_units_listing_id_idx" ON "rent_units"("listing_id");
