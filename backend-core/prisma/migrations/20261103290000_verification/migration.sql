-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "verification" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "verification_note" TEXT,
ADD COLUMN     "verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "verification_docs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "filename" TEXT,
    "size" INTEGER NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_docs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_docs_tenant_id_idx" ON "verification_docs"("tenant_id");

-- AddForeignKey
ALTER TABLE "verification_docs" ADD CONSTRAINT "verification_docs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

