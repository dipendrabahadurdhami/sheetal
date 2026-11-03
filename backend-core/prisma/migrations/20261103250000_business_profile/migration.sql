-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" TEXT,
ADD COLUMN     "vat_registered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website" TEXT;

