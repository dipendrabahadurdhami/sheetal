-- P2-W5: kernel columns on the listings tables (who changed it, version for 409, soft-delete marks). Additive: no row is changed.
ALTER TABLE "listings" ADD COLUMN "created_by" TEXT, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
