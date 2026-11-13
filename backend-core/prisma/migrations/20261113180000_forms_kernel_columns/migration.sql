-- P2-W6: kernel columns on online forms (who changed it last, version for 409). Additive: no row is changed.
ALTER TABLE "forms" ADD COLUMN "updated_by" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
