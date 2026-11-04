-- CreateTable
CREATE TABLE "biz_invoices" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'invoice',
    "no" TEXT,
    "fy" TEXT,
    "credit_for_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "to_name" TEXT NOT NULL,
    "to_phone" TEXT,
    "to_pan" TEXT,
    "order" TEXT,
    "booking_id" TEXT,
    "issued_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "vat_pct" INTEGER NOT NULL DEFAULT 13,
    "lines" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "vat" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "notes" TEXT,
    "reason" TEXT,
    "cancel_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "biz_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biz_receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "paid_on" DATE NOT NULL,
    "ref" TEXT,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biz_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_counters" (
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "doc_counters_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateIndex
CREATE INDEX "biz_invoices_tenant_id_status_issued_on_idx" ON "biz_invoices"("tenant_id", "status", "issued_on");

-- CreateIndex
CREATE INDEX "biz_invoices_branch_id_idx" ON "biz_invoices"("branch_id");

-- CreateIndex
CREATE INDEX "biz_invoices_tenant_id_booking_id_idx" ON "biz_invoices"("tenant_id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "biz_invoices_tenant_id_no_key" ON "biz_invoices"("tenant_id", "no");

-- CreateIndex
CREATE INDEX "biz_receipts_invoice_id_idx" ON "biz_receipts"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "biz_receipts_tenant_id_no_key" ON "biz_receipts"("tenant_id", "no");

-- CreateIndex
CREATE UNIQUE INDEX "biz_receipts_invoice_id_ref_key" ON "biz_receipts"("invoice_id", "ref");

-- AddForeignKey
ALTER TABLE "biz_invoices" ADD CONSTRAINT "biz_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biz_receipts" ADD CONSTRAINT "biz_receipts_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "biz_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
