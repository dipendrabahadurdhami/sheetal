-- CreateTable
CREATE TABLE "favourites" (
    "user_id" TEXT NOT NULL,
    "listing_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favourites_pkey" PRIMARY KEY ("user_id","listing_id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "listing_id" INTEGER,
    "user_id" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'new',
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "listing_id" INTEGER,
    "tenant_id" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'published',
    "reply" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upgrade_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upgrade_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favourites_listing_id_idx" ON "favourites"("listing_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_created_at_idx" ON "leads"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "leads_listing_id_idx" ON "leads"("listing_id");

-- CreateIndex
CREATE INDEX "reviews_listing_id_status_idx" ON "reviews"("listing_id", "status");

-- CreateIndex
CREATE INDEX "reviews_tenant_id_status_idx" ON "reviews"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_user_id_listing_id_key" ON "reviews"("user_id", "listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_user_id_tenant_id_key" ON "reviews"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "upgrade_requests_status_created_at_idx" ON "upgrade_requests"("status", "created_at");
