-- CreateTable
CREATE TABLE "banners" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'paid',
    "desktop" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "button" TEXT NOT NULL DEFAULT '',
    "days" INTEGER NOT NULL,
    "start_on" DATE NOT NULL,
    "end_on" DATE NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "invoice_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting',
    "review_note" TEXT,
    "reviewed_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "paid_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "banners_seq_key" ON "banners"("seq");

-- CreateIndex
CREATE INDEX "banners_status_start_on_end_on_idx" ON "banners"("status", "start_on", "end_on");

-- CreateIndex
CREATE INDEX "banners_tenant_id_created_at_idx" ON "banners"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "banners_invoice_id_idx" ON "banners"("invoice_id");
