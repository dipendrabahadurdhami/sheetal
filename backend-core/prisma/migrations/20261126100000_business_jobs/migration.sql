-- Jobs posted by businesses from their panel (Jobs), checked by Sheetal unless the business is verified.
ALTER TABLE "job_posts" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "job_posts" ADD COLUMN "review" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "job_posts" ADD COLUMN "review_note" TEXT;
CREATE INDEX "job_posts_tenant_id_idx" ON "job_posts"("tenant_id");
ALTER TABLE "job_posts" ADD CONSTRAINT "job_posts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
