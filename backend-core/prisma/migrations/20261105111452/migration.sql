-- CreateTable
CREATE TABLE "forms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tpl" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "dest" TEXT NOT NULL DEFAULT 'leads',
    "assignee_id" TEXT,
    "thanks" TEXT NOT NULL DEFAULT '',
    "style" JSONB NOT NULL DEFAULT '{}',
    "places" JSONB NOT NULL DEFAULT '{}',
    "pay" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_responses" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "pay_amount" INTEGER,
    "pay_status" TEXT,
    "lead_id" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forms_slug_key" ON "forms"("slug");

-- CreateIndex
CREATE INDEX "forms_tenant_id_created_at_idx" ON "forms"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "forms_branch_id_idx" ON "forms"("branch_id");

-- CreateIndex
CREATE INDEX "form_responses_tenant_id_created_at_idx" ON "form_responses"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "form_responses_form_id_created_at_idx" ON "form_responses"("form_id", "created_at");

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
