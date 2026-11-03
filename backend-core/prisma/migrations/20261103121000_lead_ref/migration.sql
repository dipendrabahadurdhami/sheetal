-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "ref" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "leads_ref_key" ON "leads"("ref");

