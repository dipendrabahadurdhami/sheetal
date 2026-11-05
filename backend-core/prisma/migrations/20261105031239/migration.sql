-- CreateTable
CREATE TABLE "rent_owners" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "fee_bp" INTEGER NOT NULL DEFAULT 800,
    "bank" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_units" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'Flat',
    "rent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'vacant',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_leases" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "renter" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "start_on" DATE NOT NULL,
    "end_on" DATE NOT NULL,
    "rent" INTEGER NOT NULL,
    "deposit" INTEGER NOT NULL DEFAULT 0,
    "due_day" INTEGER NOT NULL DEFAULT 7,
    "late_fee_bp" INTEGER NOT NULL DEFAULT 200,
    "late_after_days" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'active',
    "ended_on" DATE,
    "deposit_status" TEXT NOT NULL DEFAULT 'held',
    "deposit_returned" INTEGER,
    "deposit_note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_bills" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "lease_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "late_fee" INTEGER NOT NULL DEFAULT 0,
    "late_waived" BOOLEAN NOT NULL DEFAULT false,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "paid_on" DATE NOT NULL,
    "ref" TEXT,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rent_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_repairs" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "vendor" TEXT,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "done_on" DATE,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rent_repairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_statements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "collected" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "repairs" INTEGER NOT NULL,
    "payable" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rent_owners_tenant_id_branch_id_idx" ON "rent_owners"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "rent_units_tenant_id_branch_id_idx" ON "rent_units"("tenant_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "rent_leases_seq_key" ON "rent_leases"("seq");

-- CreateIndex
CREATE INDEX "rent_leases_tenant_id_status_idx" ON "rent_leases"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "rent_leases_unit_id_idx" ON "rent_leases"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "rent_bills_seq_key" ON "rent_bills"("seq");

-- CreateIndex
CREATE INDEX "rent_bills_tenant_id_month_idx" ON "rent_bills"("tenant_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "rent_bills_lease_id_month_key" ON "rent_bills"("lease_id", "month");

-- CreateIndex
CREATE INDEX "rent_payments_tenant_id_paid_on_idx" ON "rent_payments"("tenant_id", "paid_on");

-- CreateIndex
CREATE INDEX "rent_payments_bill_id_idx" ON "rent_payments"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "rent_repairs_seq_key" ON "rent_repairs"("seq");

-- CreateIndex
CREATE INDEX "rent_repairs_tenant_id_status_idx" ON "rent_repairs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "owner_statements_tenant_id_month_idx" ON "owner_statements"("tenant_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "owner_statements_owner_id_month_key" ON "owner_statements"("owner_id", "month");

-- AddForeignKey
ALTER TABLE "rent_owners" ADD CONSTRAINT "rent_owners_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_units" ADD CONSTRAINT "rent_units_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_units" ADD CONSTRAINT "rent_units_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "rent_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_leases" ADD CONSTRAINT "rent_leases_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "rent_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_bills" ADD CONSTRAINT "rent_bills_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "rent_leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "rent_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_repairs" ADD CONSTRAINT "rent_repairs_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "rent_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "rent_owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
