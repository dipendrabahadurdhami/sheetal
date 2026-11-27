-- Listing banners: a home page banner made from a business's own listing (its photos as a grid, opening the listing).
ALTER TABLE "banners" ADD COLUMN "listing_id" INTEGER;
CREATE INDEX "banners_listing_id_idx" ON "banners"("listing_id");
