-- P1-DB-1b review_audit_columns: the kernel base repository writes created_by / updated_by on every change
-- (platform/src/core/repository.ts). Reviews got version and soft delete in kernel_base, but not these two.
-- ADDITIVE ONLY: two empty columns; old code does not know them and keeps working.

-- AlterTable
ALTER TABLE "reviews"
  ADD COLUMN "created_by" TEXT,
  ADD COLUMN "updated_by" TEXT;
