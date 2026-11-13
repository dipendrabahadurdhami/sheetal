-- P2-W1 stage 3: kernel columns on agreements (who changed it last, version for 409, soft-delete marks). Additive: no row is changed.
ALTER TABLE "agreements" ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
