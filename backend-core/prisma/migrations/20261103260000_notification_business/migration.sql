-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "tenant_id" TEXT;

-- CreateIndex
CREATE INDEX "notifications_user_id_tenant_id_created_at_idx" ON "notifications"("user_id", "tenant_id", "created_at");


-- Existing panel notifications belong to the business their reader owns or works in (first one), when it's clear.
UPDATE "notifications" n SET "tenant_id" = m."tenant_id"
FROM (SELECT DISTINCT ON ("user_id") "user_id", "tenant_id" FROM "memberships" ORDER BY "user_id", "created_at") m
WHERE n."user_id" = m."user_id" AND n."link" LIKE '/business%';
