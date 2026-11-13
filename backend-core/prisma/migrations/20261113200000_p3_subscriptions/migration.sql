-- P3-DB-1 p3_subscriptions: the tables that hold per-app subscription state (MARKETPLACE-AND-BILLING.md section 15).
-- ADDITIVE ONLY: new tables and new columns; nothing is dropped, renamed or changed, and no existing row changes meaning:
--   tenants.billing_mode defaults to 'plans' (today's behaviour), ai_usage.source is filled from the old own flag.
-- Fixed words are text columns with a CHECK (Prisma does not see CHECKs; the model comments name the words).
-- Go back (only if applied by mistake, before any Phase 3 sale): drop the tables subscription_events, subscriptions, entitlement_grants,
-- addon_subscriptions, billing_locks, billing_migration_runs, ai_credit_grants, and the columns tenants.billing_mode,
-- ai_usage.app_id / provider / source / request_id.

-- ───────────── Changed tables ─────────────

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "billing_mode" TEXT NOT NULL DEFAULT 'plans';
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_billing_mode_check" CHECK ("billing_mode" IN ('plans', 'shadow', 'apps'));

-- AlterTable
ALTER TABLE "ai_usage" ADD COLUMN     "app_id" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "request_id" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'sheetal';
-- Old rows made with the business's own key were marked by the own flag.
UPDATE "ai_usage" SET "source" = 'own' WHERE "own" = true;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_source_check" CHECK ("source" IN ('sheetal', 'own', 'preview'));

-- ───────────── New tables ─────────────

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "edition_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "period_months" INTEGER,
    "price_gross_paisa" BIGINT NOT NULL DEFAULT 0,
    "list_price_gross_paisa" BIGINT NOT NULL DEFAULT 0,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "trial_used_at" TIMESTAMP(3),
    "grace_until" TIMESTAMP(3),
    "read_only_from" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "pending_edition_id" TEXT,
    "pending_period_months" INTEGER,
    "coupon_id" TEXT,
    "coupon_periods_left" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'install',
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),
    "migration_run_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('active', 'trialing', 'past_due', 'read_only', 'cancelled', 'expired')),
    CONSTRAINT "subscriptions_source_check" CHECK ("source" IN ('install', 'purchase', 'trial', 'migration', 'staff', 'gift', 'covered')),
    CONSTRAINT "subscriptions_period_months_check" CHECK ("period_months" IS NULL OR "period_months" IN (1, 3, 6, 12)),
    -- A paid period always has an end date.
    CONSTRAINT "subscriptions_period_end_check" CHECK ("period_months" IS NULL OR "current_period_end" IS NOT NULL),
    CONSTRAINT "subscriptions_price_check" CHECK ("price_gross_paisa" >= 0 AND "list_price_gross_paisa" >= 0)
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "from_edition" TEXT,
    "to_edition" TEXT,
    "amount_paisa" BIGINT,
    "invoice_id" TEXT,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_events_actor_kind_check" CHECK ("actor_kind" IN ('user', 'staff', 'system', 'migration'))
);

-- CreateTable
CREATE TABLE "entitlement_grants" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "app_id" TEXT,
    "key" TEXT,
    "value" INTEGER,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "migration_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entitlement_grants_kind_check" CHECK ("kind" IN ('app', 'limit', 'feature', 'seats', 'ai_credits_monthly')),
    CONSTRAINT "entitlement_grants_source_check" CHECK ("source" IN ('migration', 'covered', 'gift', 'staff', 'partner')),
    -- A grant always says why.
    CONSTRAINT "entitlement_grants_reason_check" CHECK (length(trim("reason")) > 0)
);

-- CreateTable
CREATE TABLE "addon_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL DEFAULT '',
    "addon_key" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "renew_qty" INTEGER NOT NULL,
    "unit_price_gross_paisa" BIGINT NOT NULL,
    "period_months" INTEGER NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'purchase',
    "migration_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addon_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "addon_subscriptions_qty_check" CHECK ("qty" >= 0 AND "renew_qty" >= 0 AND "unit_price_gross_paisa" >= 0)
);

-- CreateTable
CREATE TABLE "billing_locks" (
    "tenant_id" TEXT NOT NULL,
    "legacy_monthly_gross_paisa" BIGINT NOT NULL,
    "legacy_period_months" INTEGER NOT NULL,
    "covers_apps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lock_end" TIMESTAMP(3) NOT NULL,
    "migration_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_locks_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "billing_migration_runs" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "report" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT NOT NULL,

    CONSTRAINT "billing_migration_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_migration_runs_mode_check" CHECK ("mode" IN ('dry_run', 'apply', 'restore'))
);

-- CreateTable
CREATE TABLE "ai_credit_grants" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_grants_pkey" PRIMARY KEY ("id"),
    -- Spending can never overspend or "make" credits.
    CONSTRAINT "ai_credit_grants_remaining_check" CHECK ("remaining" >= 0 AND "remaining" <= "credits"),
    CONSTRAINT "ai_credit_grants_source_check" CHECK ("source" IN ('plan', 'topup', 'trial', 'migration', 'gift', 'refund'))
);

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_app_id_key" ON "subscriptions"("tenant_id", "app_id");

-- CreateIndex
CREATE INDEX "subscription_events_tenant_id_at_idx" ON "subscription_events"("tenant_id", "at");

-- CreateIndex
CREATE INDEX "subscription_events_type_at_idx" ON "subscription_events"("type", "at");

-- CreateIndex
CREATE INDEX "subscription_events_subscription_id_idx" ON "subscription_events"("subscription_id");

-- CreateIndex
CREATE INDEX "entitlement_grants_tenant_id_ends_at_idx" ON "entitlement_grants"("tenant_id", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "addon_subscriptions_tenant_id_app_id_addon_key_key" ON "addon_subscriptions"("tenant_id", "app_id", "addon_key");

-- CreateIndex
CREATE INDEX "ai_credit_grants_tenant_id_expires_at_idx" ON "ai_credit_grants"("tenant_id", "expires_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_subscriptions" ADD CONSTRAINT "addon_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_locks" ADD CONSTRAINT "billing_locks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_grants" ADD CONSTRAINT "ai_credit_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
