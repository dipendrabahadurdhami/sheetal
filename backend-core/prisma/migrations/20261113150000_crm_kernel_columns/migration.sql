-- P2-W5: kernel columns on the crm tables (who changed it, version for 409, soft-delete marks). Additive: no row is changed.
ALTER TABLE "leads" ADD COLUMN "created_by" TEXT, ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" TEXT;
