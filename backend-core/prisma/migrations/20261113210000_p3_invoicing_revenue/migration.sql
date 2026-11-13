-- P3-DB-2 p3_invoicing_revenue: tax invoices in paisa with lines, payments in paisa with test/live mode and refunds, the revenue ledger,
-- coupons and staff approvals (MARKETPLACE-AND-BILLING.md sections 4, 9, 11, 13 and 15).
-- ADDITIVE ONLY: new tables, new columns, invoices.plan_id becomes optional (old rows all keep their plan). Nothing is deleted.
-- Backfill (same pattern as 20261113190000_rentals_paisa): every old invoice and payment gets its paisa twin (rupees × 100). Old invoice
-- kinds (plan, addon, boost, banner) keep paisa = rupees × 100 on every write through a trigger, so today's code needs no change.
-- Payments made with eSewa's public test merchant (product code EPAYTEST) are marked mode 'test'; all others 'live'.
-- Guards: an issued tax invoice's number and money can't change; a revenue entry can't be updated or deleted; refunds never exceed
-- the payment. Go back (only before any Phase 3 sale): drop the five new tables, the new columns and the four trigger functions below.

-- ───────────── Invoices ─────────────

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "plan_id" DROP NOT NULL,
ADD COLUMN     "catalog_version" INTEGER,
ADD COLUMN     "coupon_id" TEXT,
ADD COLUMN     "credit_for_id" TEXT,
ADD COLUMN     "fy" TEXT,
ADD COLUMN     "issued_at" TIMESTAMP(3),
ADD COLUMN     "no" INTEGER,
ADD COLUMN     "seller_snapshot" JSONB,
ADD COLUMN     "subtotal_paisa" BIGINT,
ADD COLUMN     "total_paisa" BIGINT,
ADD COLUMN     "vat_paisa" BIGINT;

UPDATE "invoices" SET "subtotal_paisa" = "subtotal"::BIGINT * 100, "vat_paisa" = "vat"::BIGINT * 100, "total_paisa" = "total"::BIGINT * 100
  WHERE "total_paisa" IS NULL;

-- The old kinds are written in whole rupees by today's code: their paisa twins follow on every insert and update.
CREATE OR REPLACE FUNCTION "invoices_paisa_sync"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."kind" IN ('plan', 'addon', 'boost', 'banner') THEN
    NEW."subtotal_paisa" := NEW."subtotal"::BIGINT * 100;
    NEW."vat_paisa" := NEW."vat"::BIGINT * 100;
    NEW."total_paisa" := NEW."total"::BIGINT * 100;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "invoices_paisa_sync" ON "invoices";
CREATE TRIGGER "invoices_paisa_sync" BEFORE INSERT OR UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION "invoices_paisa_sync"();

-- An issued tax invoice is final: its number, fiscal year, issue time and money never change (refunds are credit notes).
CREATE OR REPLACE FUNCTION "invoices_issued_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."issued_at" IS NOT NULL AND (
       NEW."issued_at" IS DISTINCT FROM OLD."issued_at" OR NEW."no" IS DISTINCT FROM OLD."no" OR NEW."fy" IS DISTINCT FROM OLD."fy"
    OR NEW."subtotal_paisa" IS DISTINCT FROM OLD."subtotal_paisa" OR NEW."vat_paisa" IS DISTINCT FROM OLD."vat_paisa"
    OR NEW."total_paisa" IS DISTINCT FROM OLD."total_paisa" OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
    OR NEW."vat" IS DISTINCT FROM OLD."vat" OR NEW."total" IS DISTINCT FROM OLD."total") THEN
    RAISE EXCEPTION 'An issued tax invoice can''t be changed (invoice %). Make a credit note instead.', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "invoices_issued_guard" ON "invoices";
CREATE TRIGGER "invoices_issued_guard" BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION "invoices_issued_guard"();

-- NOT VALID: old rows are not re-checked (they only ever had the four old kinds); every new or changed row is.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_kind_check" CHECK ("kind" IN ('plan', 'addon', 'boost', 'banner', 'subscription', 'credit')) NOT VALID;
-- A number is given with its fiscal year and its issue time, or not at all.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_check" CHECK (("no" IS NULL AND "fy" IS NULL) OR ("no" IS NOT NULL AND "fy" IS NOT NULL AND "issued_at" IS NOT NULL));

-- CreateIndex
CREATE UNIQUE INDEX "invoices_fy_no_key" ON "invoices"("fy", "no");

-- ───────────── Payments ─────────────

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "amount_paisa" BIGINT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'live',
ADD COLUMN     "refund_ref" TEXT,
ADD COLUMN     "refund_sent_at" TIMESTAMP(3),
ADD COLUMN     "refunded_paisa" BIGINT NOT NULL DEFAULT 0;

UPDATE "payments" SET "amount_paisa" = "amount"::BIGINT * 100 WHERE "amount_paisa" IS NULL;
UPDATE "payments" SET "mode" = 'test' WHERE "provider" = 'esewa' AND "raw"::TEXT LIKE '%"EPAYTEST"%';

-- Today's code writes only the rupee amount: the paisa twin is filled when it is missing.
CREATE OR REPLACE FUNCTION "payments_paisa_fill"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."amount_paisa" IS NULL THEN NEW."amount_paisa" := NEW."amount"::BIGINT * 100; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "payments_paisa_fill" ON "payments";
CREATE TRIGGER "payments_paisa_fill" BEFORE INSERT OR UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION "payments_paisa_fill"();

ALTER TABLE "payments" ADD CONSTRAINT "payments_mode_check" CHECK ("mode" IN ('live', 'test'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_check" CHECK ("refunded_paisa" >= 0 AND ("amount_paisa" IS NULL OR "refunded_paisa" <= "amount_paisa"));

-- ───────────── New tables ─────────────

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "app_id" TEXT,
    "edition_id" TEXT,
    "subscription_id" TEXT,
    "description" JSONB NOT NULL DEFAULT '{}',
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_gross_paisa" BIGINT NOT NULL,
    "discount_paisa" BIGINT NOT NULL DEFAULT 0,
    "gross_paisa" BIGINT NOT NULL,
    "net_paisa" BIGINT NOT NULL,
    "vat_paisa" BIGINT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_lines_kind_check" CHECK ("kind" IN ('subscription', 'addon', 'proration_credit', 'price_protection', 'ai', 'carry')),
    -- Net + VAT = gross on every line.
    CONSTRAINT "invoice_lines_money_check" CHECK ("net_paisa" + "vat_paisa" = "gross_paisa")
);

-- CreateTable
CREATE TABLE "revenue_entries" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_line_id" TEXT,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT,
    "edition_id" TEXT,
    "kind" TEXT NOT NULL,
    "sale_type" TEXT NOT NULL,
    "gross_paisa" BIGINT NOT NULL,
    "vat_paisa" BIGINT NOT NULL,
    "net_paisa" BIGINT NOT NULL,
    "commission_bp" INTEGER NOT NULL,
    "commission_paisa" BIGINT NOT NULL,
    "partner_bp" INTEGER NOT NULL,
    "partner_paisa" BIGINT NOT NULL,
    "sheetal_net_paisa" BIGINT NOT NULL,
    "publisher_paisa" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'live',
    "catalog_version" INTEGER,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "revenue_entries_kind_check" CHECK ("kind" IN ('sale', 'refund')),
    CONSTRAINT "revenue_entries_sale_type_check" CHECK ("sale_type" IN ('new', 'renewal', 'upgrade', 'addon', 'ai')),
    -- Only live money is revenue (SETTINGS.md section 7.4).
    CONSTRAINT "revenue_entries_mode_check" CHECK ("mode" = 'live'),
    CONSTRAINT "revenue_entries_bp_check" CHECK ("commission_bp" BETWEEN 0 AND 10000 AND "partner_bp" BETWEEN 0 AND 10000),
    -- The splits always add back: net + VAT = gross, commission + publisher = net, partner + Sheetal's net = commission.
    CONSTRAINT "revenue_entries_money_check" CHECK ("net_paisa" + "vat_paisa" = "gross_paisa" AND "commission_paisa" + "publisher_paisa" = "net_paisa" AND "partner_paisa" + "sheetal_net_paisa" = "commission_paisa")
);

-- The revenue ledger is append-only: a mistake is corrected by a new refund row, never by changing or removing one.
CREATE OR REPLACE FUNCTION "revenue_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Revenue entries can''t be changed or deleted (entry %).', OLD."id" USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS "revenue_entries_append_only" ON "revenue_entries";
CREATE TRIGGER "revenue_entries_append_only" BEFORE UPDATE OR DELETE ON "revenue_entries" FOR EACH ROW EXECUTE FUNCTION "revenue_entries_append_only"();

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "applies_to" TEXT NOT NULL DEFAULT 'all',
    "app_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edition_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "first_purchase_only" BOOLEAN NOT NULL DEFAULT false,
    "min_spend_paisa" BIGINT,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "max_redemptions" INTEGER,
    "per_business_limit" INTEGER NOT NULL DEFAULT 1,
    "periods" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "coupons_code_check" CHECK ("code" = upper("code") AND length("code") BETWEEN 3 AND 32),
    CONSTRAINT "coupons_kind_check" CHECK ("kind" IN ('percent', 'fixed_paisa', 'trial_days')),
    CONSTRAINT "coupons_value_check" CHECK ("value" > 0 AND ("kind" <> 'percent' OR "value" <= 100)),
    CONSTRAINT "coupons_applies_to_check" CHECK ("applies_to" IN ('all', 'apps', 'editions')),
    CONSTRAINT "coupons_periods_check" CHECK ("periods" BETWEEN 1 AND 12 AND "per_business_limit" >= 1)
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "discount_paisa" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_approvals" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "payload" JSONB NOT NULL,
    "amount_paisa" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "maker_id" TEXT NOT NULL,
    "maker_note" TEXT NOT NULL DEFAULT '',
    "checker_id" TEXT,
    "checker_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "platform_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_approvals_status_check" CHECK ("status" IN ('pending', 'approved', 'executed', 'failed', 'rejected', 'cancelled', 'expired')),
    -- The checker is never the maker.
    CONSTRAINT "platform_approvals_checker_check" CHECK ("checker_id" IS NULL OR "checker_id" <> "maker_id")
);

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "revenue_entries_paid_at_idx" ON "revenue_entries"("paid_at");

-- CreateIndex
CREATE INDEX "revenue_entries_app_id_paid_at_idx" ON "revenue_entries"("app_id", "paid_at");

-- CreateIndex
CREATE INDEX "revenue_entries_tenant_id_paid_at_idx" ON "revenue_entries"("tenant_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_entries_payment_id_invoice_line_id_kind_key" ON "revenue_entries"("payment_id", "invoice_line_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupon_redemptions_tenant_id_idx" ON "coupon_redemptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_tenant_id_invoice_id_key" ON "coupon_redemptions"("coupon_id", "tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "platform_approvals_status_created_at_idx" ON "platform_approvals"("status", "created_at");

-- CreateIndex
CREATE INDEX "platform_approvals_status_expires_at_idx" ON "platform_approvals"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
