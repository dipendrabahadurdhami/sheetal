-- CreateEnum
CREATE TYPE "ListingPurpose" AS ENUM ('sale', 'rent');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('draft', 'pending', 'published', 'sold', 'rented', 'expired', 'removed');

-- CreateTable
CREATE TABLE "listings" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tenant_id" TEXT,
    "user_id" TEXT,
    "purpose" "ListingPurpose" NOT NULL,
    "category" TEXT NOT NULL,
    "property_type" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "highlights" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'draft',
    "price" BIGINT,
    "price_per" TEXT,
    "negotiable" BOOLEAN NOT NULL DEFAULT false,
    "province" TEXT,
    "district" TEXT,
    "city" TEXT,
    "area" TEXT,
    "street" TEXT,
    "ward" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "kitchens" INTEGER,
    "living_rooms" INTEGER,
    "floors" DOUBLE PRECISION,
    "parking" TEXT,
    "land_area" TEXT,
    "land_sqft" DOUBLE PRECISION,
    "built_area" TEXT,
    "road_access" TEXT,
    "road_type" TEXT,
    "facing" TEXT,
    "built_year" TEXT,
    "furnishing" TEXT,
    "facilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "youtube_url" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "private" JSONB NOT NULL DEFAULT '{}',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "featured_order" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "suggest" JSONB,
    "check_due_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "last_checked_by" TEXT,
    "legacy_id" INTEGER,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_photos" (
    "id" SERIAL NOT NULL,
    "listing_id" INTEGER NOT NULL,
    "file" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "listing_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listings_code_key" ON "listings"("code");

-- CreateIndex
CREATE UNIQUE INDEX "listings_slug_key" ON "listings"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "listings_legacy_id_key" ON "listings"("legacy_id");

-- CreateIndex
CREATE INDEX "listings_status_purpose_published_at_idx" ON "listings"("status", "purpose", "published_at");

-- CreateIndex
CREATE INDEX "listings_status_featured_featured_order_idx" ON "listings"("status", "featured", "featured_order");

-- CreateIndex
CREATE INDEX "listings_district_idx" ON "listings"("district");

-- CreateIndex
CREATE INDEX "listings_category_idx" ON "listings"("category");

-- CreateIndex
CREATE INDEX "listings_tenant_id_status_idx" ON "listings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "listings_user_id_idx" ON "listings"("user_id");

-- CreateIndex
CREATE INDEX "listing_photos_listing_id_sort_idx" ON "listing_photos"("listing_id", "sort");

-- AddForeignKey
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
