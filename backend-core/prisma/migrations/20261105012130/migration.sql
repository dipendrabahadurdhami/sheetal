-- CreateTable
CREATE TABLE "payout_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "payout_id" TEXT,
    "source" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "gross" INTEGER NOT NULL,
    "fee_bp" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "collected_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'batch',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gross" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "period_from" DATE,
    "period_to" DATE,
    "scheduled_on" DATE NOT NULL,
    "paid_on" DATE,
    "bank_ref" TEXT,
    "bank" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "fail_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_items_tenant_id_payout_id_idx" ON "payout_items"("tenant_id", "payout_id");

-- CreateIndex
CREATE INDEX "payout_items_payout_id_idx" ON "payout_items"("payout_id");

-- CreateIndex
CREATE INDEX "payout_items_tenant_id_branch_id_collected_on_idx" ON "payout_items"("tenant_id", "branch_id", "collected_on");

-- CreateIndex
CREATE UNIQUE INDEX "payout_items_tenant_id_source_ref_key" ON "payout_items"("tenant_id", "source", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_seq_key" ON "payouts"("seq");

-- CreateIndex
CREATE INDEX "payouts_tenant_id_status_scheduled_on_idx" ON "payouts"("tenant_id", "status", "scheduled_on");

-- CreateIndex
CREATE INDEX "payouts_tenant_id_branch_id_idx" ON "payouts"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "payouts_status_scheduled_on_idx" ON "payouts"("status", "scheduled_on");

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
