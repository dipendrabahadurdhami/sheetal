-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "old_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "code_prefix" TEXT;
