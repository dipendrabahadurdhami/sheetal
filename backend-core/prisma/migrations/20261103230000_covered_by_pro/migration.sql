-- A business can be covered by another business's Pro plan (same owner).
ALTER TABLE "tenants" ADD COLUMN "covered_by_id" TEXT;
CREATE INDEX "tenants_covered_by_id_idx" ON "tenants"("covered_by_id");
