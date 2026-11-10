-- CreateTable
CREATE TABLE "boosts" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "listing_id" INTEGER NOT NULL,
    "place" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "days" INTEGER NOT NULL,
    "start_on" DATE NOT NULL,
    "end_on" DATE NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "invoice_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'paid',
    "status" TEXT NOT NULL DEFAULT 'awaiting',
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "paid_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boosts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boosts_seq_key" ON "boosts"("seq");

-- CreateIndex
CREATE INDEX "boosts_place_status_start_on_end_on_idx" ON "boosts"("place", "status", "start_on", "end_on");

-- CreateIndex
CREATE INDEX "boosts_tenant_id_created_at_idx" ON "boosts"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "boosts_listing_id_idx" ON "boosts"("listing_id");

-- CreateIndex
CREATE INDEX "boosts_invoice_id_idx" ON "boosts"("invoice_id");
