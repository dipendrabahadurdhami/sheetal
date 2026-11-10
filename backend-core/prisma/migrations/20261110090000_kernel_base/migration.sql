-- P1-DB-1 kernel_base: the first Phase 1 database step. ADDITIVE ONLY: nothing is dropped, renamed or changed, so the
-- old code keeps working unchanged.
--   1. Kernel columns (version, updatedBy, soft delete) on expenses, recurring expenses and reviews (KERNEL.md section 6.1)
--   2. Paisa columns next to the rupee columns, filled with rupees x 100 (KERNEL.md section 4)
--   3. The event outbox and its "handled once" table (KERNEL.md section 9)
--   4. The demo business flag (FRONTEND-KIT.md section 8)
-- The rupee "amount" columns stay. They are dropped only in a later, separate migration, after the code has moved over.

-- ───────────── 1. Kernel columns ─────────────

-- AlterTable
ALTER TABLE "expenses"
  ADD COLUMN "updated_by" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" TEXT;

-- AlterTable
ALTER TABLE "recurring_expenses"
  ADD COLUMN "updated_by" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" TEXT;

-- AlterTable (reviews: version plus soft delete, so every app follows the same kernel rules. Lead decision 10 Nov:
-- a business still never deletes a review; only Sheetal can, and the row is kept.)
ALTER TABLE "reviews"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" TEXT;

-- CreateIndex ("not deleted" lists: one business, deleted_at empty, by date or status)
CREATE INDEX "expenses_tenant_id_deleted_at_spent_on_idx" ON "expenses"("tenant_id", "deleted_at", "spent_on");

-- CreateIndex
CREATE INDEX "recurring_expenses_tenant_id_deleted_at_status_idx" ON "recurring_expenses"("tenant_id", "deleted_at", "status");

-- ───────────── 2. Paisa columns, side by side with the rupee columns ─────────────

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN "amount_paisa" BIGINT;

-- AlterTable
ALTER TABLE "recurring_expenses" ADD COLUMN "amount_paisa" BIGINT;

-- Backfill: paisa = rupees x 100. The cast to BIGINT comes first: amount is a 32-bit INTEGER and x 100 would overflow it
-- for amounts above about 21 million rupees. Safe to run again (it only fills rows that are still empty).
UPDATE "expenses" SET "amount_paisa" = "amount"::BIGINT * 100 WHERE "amount_paisa" IS NULL;
UPDATE "recurring_expenses" SET "amount_paisa" = "amount"::BIGINT * 100 WHERE "amount_paisa" IS NULL;

-- ───────────── 3. Event outbox ─────────────

-- CreateTable
CREATE TABLE "event_outbox" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "v" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "actor" JSONB NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_try_at" TIMESTAMP(3),

    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable (the foreign key is written inside the table so this file holds only CREATE TABLE / CREATE INDEX)
CREATE TABLE "event_deliveries" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "handler_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "event_outbox_dispatched_at_next_try_at_created_at_idx" ON "event_outbox"("dispatched_at", "next_try_at", "created_at");

-- CreateIndex
CREATE INDEX "event_outbox_tenant_id_created_at_idx" ON "event_outbox"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "event_outbox_name_created_at_idx" ON "event_outbox"("name", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_deliveries_event_id_handler_id_key" ON "event_deliveries"("event_id", "handler_id");

-- CreateIndex
CREATE INDEX "event_deliveries_handler_id_created_at_idx" ON "event_deliveries"("handler_id", "created_at");

-- ───────────── 4. Demo business flag ─────────────

-- AlterTable
ALTER TABLE "tenants"
  ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "demo_expires_at" TIMESTAMP(3);

-- CreateIndex (the daily demo.cleanup job: demo = true and demo_expires_at in the past)
CREATE INDEX "tenants_demo_demo_expires_at_idx" ON "tenants"("demo", "demo_expires_at");
