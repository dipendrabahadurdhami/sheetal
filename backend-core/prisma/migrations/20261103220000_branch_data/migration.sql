-- A business's work belongs to a branch: listings (and what hangs off them), leads, rooms, bookings and POS.
ALTER TABLE "listings"   ADD COLUMN "branch_id" TEXT;
ALTER TABLE "leads"      ADD COLUMN "branch_id" TEXT;
ALTER TABLE "rooms"      ADD COLUMN "branch_id" TEXT;
ALTER TABLE "bookings"   ADD COLUMN "branch_id" TEXT;
ALTER TABLE "menu_items" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "shifts"     ADD COLUMN "branch_id" TEXT;
ALTER TABLE "pos_bills"  ADD COLUMN "branch_id" TEXT;

-- Each business's first branch (its head office) takes everything that has no branch yet.
CREATE TEMP TABLE first_branch AS
  SELECT DISTINCT ON ("tenant_id") "tenant_id", "id" FROM "branches" ORDER BY "tenant_id", "sort", "created_at";

-- Rooms keep the branch they named.
UPDATE "rooms" r SET "branch_id" = b."id" FROM "branches" b WHERE b."tenant_id" = r."tenant_id" AND b."name" = r."branch";
UPDATE "rooms" r SET "branch_id" = f."id" FROM first_branch f WHERE r."branch_id" IS NULL AND f."tenant_id" = r."tenant_id";
ALTER TABLE "rooms" DROP COLUMN "branch";

UPDATE "listings" l SET "branch_id" = f."id" FROM first_branch f WHERE f."tenant_id" = l."tenant_id";
-- Leads follow their listing; others go to the head office.
UPDATE "leads" x SET "branch_id" = l."branch_id" FROM "listings" l WHERE l."id" = x."listing_id" AND l."tenant_id" = x."tenant_id";
UPDATE "leads" x SET "branch_id" = f."id" FROM first_branch f WHERE x."branch_id" IS NULL AND f."tenant_id" = x."tenant_id";
-- Bookings follow their room.
UPDATE "bookings" x SET "branch_id" = r."branch_id" FROM "rooms" r WHERE r."id" = x."room_id";
UPDATE "bookings" x SET "branch_id" = f."id" FROM first_branch f WHERE x."branch_id" IS NULL AND f."tenant_id" = x."tenant_id";
UPDATE "shifts" x SET "branch_id" = f."id" FROM first_branch f WHERE f."tenant_id" = x."tenant_id";
UPDATE "pos_bills" x SET "branch_id" = s."branch_id" FROM "shifts" s WHERE s."id" = x."shift_id";
UPDATE "pos_bills" x SET "branch_id" = f."id" FROM first_branch f WHERE x."branch_id" IS NULL AND f."tenant_id" = x."tenant_id";
-- Menu items stay shared by every branch (branch_id null).
DROP TABLE first_branch;

ALTER TABLE "listings"   ADD CONSTRAINT "listings_branch_id_fkey"   FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads"      ADD CONSTRAINT "leads_branch_id_fkey"      FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rooms"      ADD CONSTRAINT "rooms_branch_id_fkey"      FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings"   ADD CONSTRAINT "bookings_branch_id_fkey"   FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shifts"     ADD CONSTRAINT "shifts_branch_id_fkey"     FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_bills"  ADD CONSTRAINT "pos_bills_branch_id_fkey"  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "listings_branch_id_idx" ON "listings"("branch_id");
CREATE INDEX "leads_branch_id_idx" ON "leads"("branch_id");
CREATE INDEX "rooms_branch_id_idx" ON "rooms"("branch_id");
CREATE INDEX "bookings_branch_id_idx" ON "bookings"("branch_id");
CREATE INDEX "shifts_branch_id_idx" ON "shifts"("branch_id");
CREATE INDEX "pos_bills_branch_id_idx" ON "pos_bills"("branch_id");
