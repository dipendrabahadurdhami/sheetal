-- AlterTable
ALTER TABLE "outbound_emails" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "response" TEXT;

-- CreateIndex
CREATE INDEX "outbound_emails_status_next_attempt_at_idx" ON "outbound_emails"("status", "next_attempt_at");

