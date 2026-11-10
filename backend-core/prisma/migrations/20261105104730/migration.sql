-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "addons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'plan';

-- CreateTable
CREATE TABLE "tenant_addons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "addon_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "renew_qty" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_addons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_addons_tenant_id_addon_id_key" ON "tenant_addons"("tenant_id", "addon_id");
