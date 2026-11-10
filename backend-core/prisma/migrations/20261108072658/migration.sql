/*
  Warnings:

  - You are about to drop the column `own` on the `ai_usage` table. All the data in the column will be lost.
  - You are about to drop the `api_keys` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `attendance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `leave_requests` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `leave_types` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_branch_id_fkey";

-- AlterTable
ALTER TABLE "ai_usage" DROP COLUMN "own";

-- DropTable
DROP TABLE "api_keys";

-- DropTable
DROP TABLE "attendance";

-- DropTable
DROP TABLE "leave_requests";

-- DropTable
DROP TABLE "leave_types";

-- CreateTable
CREATE TABLE "ota_requests" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "listing_id" INTEGER,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "price" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "ask" TEXT,
    "ota_property_id" TEXT,
    "url" TEXT,
    "log" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ota_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ota_accounts" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_connected',
    "note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ota_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_logs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "day" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ota_requests_seq_key" ON "ota_requests"("seq");

-- CreateIndex
CREATE INDEX "ota_requests_tenant_id_status_idx" ON "ota_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ota_requests_status_created_at_idx" ON "ota_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "ota_requests_listing_id_idx" ON "ota_requests"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "ota_accounts_channel_key" ON "ota_accounts"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_key_channel_lang_key" ON "message_templates"("key", "channel", "lang");

-- CreateIndex
CREATE INDEX "reminder_logs_day_idx" ON "reminder_logs"("day");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_logs_kind_ref_id_key" ON "reminder_logs"("kind", "ref_id");
