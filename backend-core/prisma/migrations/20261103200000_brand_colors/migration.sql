-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "brand_colors" TEXT[] DEFAULT ARRAY[]::TEXT[];

