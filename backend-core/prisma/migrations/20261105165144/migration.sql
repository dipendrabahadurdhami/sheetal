-- CreateTable
CREATE TABLE "agreements" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'both',
    "values" JSONB NOT NULL DEFAULT '{}',
    "body_en" TEXT NOT NULL DEFAULT '',
    "body_ne" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "text_en" TEXT,
    "text_ne" TEXT,
    "hash" TEXT,
    "lease_id" TEXT,
    "lead_id" TEXT,
    "listing_id" INTEGER,
    "created_by" TEXT,
    "sent_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_signers" (
    "id" TEXT NOT NULL,
    "agreement_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ne" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "address_ne" TEXT NOT NULL DEFAULT '',
    "id_no" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "token_hash" TEXT,
    "otp_hash" TEXT,
    "otp_expires" TIMESTAMP(3),
    "otp_tries" INTEGER NOT NULL DEFAULT 0,
    "otp_sends" INTEGER NOT NULL DEFAULT 0,
    "otp_sent_at" TIMESTAMP(3),
    "signed_name" TEXT,
    "signed_at" TIMESTAMP(3),
    "channel" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_signers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agreements_seq_key" ON "agreements"("seq");

-- CreateIndex
CREATE INDEX "agreements_tenant_id_status_created_at_idx" ON "agreements"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "agreements_branch_id_idx" ON "agreements"("branch_id");

-- CreateIndex
CREATE INDEX "agreements_lease_id_idx" ON "agreements"("lease_id");

-- CreateIndex
CREATE INDEX "agreements_lead_id_idx" ON "agreements"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_signers_token_hash_key" ON "agreement_signers"("token_hash");

-- CreateIndex
CREATE INDEX "agreement_signers_agreement_id_idx" ON "agreement_signers"("agreement_id");

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_signers" ADD CONSTRAINT "agreement_signers_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
