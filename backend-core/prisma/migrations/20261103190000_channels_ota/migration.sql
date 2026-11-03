-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "external_uid" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "contact_key" TEXT;

-- CreateTable
CREATE TABLE "channel_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ota_feeds" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "room_type" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "last_sync" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ota_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_accounts_external_id_key" ON "channel_accounts"("external_id");

-- CreateIndex
CREATE INDEX "channel_accounts_tenant_id_idx" ON "channel_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "ota_feeds_tenant_id_idx" ON "ota_feeds"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_tenant_id_external_uid_key" ON "bookings"("tenant_id", "external_uid");

-- CreateIndex
CREATE INDEX "leads_tenant_id_contact_key_idx" ON "leads"("tenant_id", "contact_key");

