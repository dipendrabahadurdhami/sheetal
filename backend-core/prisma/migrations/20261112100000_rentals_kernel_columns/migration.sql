-- P2-W1-S1: kernel columns on the seven Rentals tables (who changed it, version for 409, soft-delete marks). Additive: no row is changed.
ALTER TABLE "rent_owners" ADD COLUMN "created_by" TEXT, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_units" ADD COLUMN "created_by" TEXT, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_bills" ADD COLUMN "created_by" TEXT, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_leases" ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_repairs" ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "owner_statements" ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
ALTER TABLE "rent_payments" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
