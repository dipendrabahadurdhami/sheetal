-- CreateTable
CREATE TABLE "mail_deliveries" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "last_error" TEXT,
    "response" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_deliveries_status_next_attempt_at_idx" ON "mail_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "mail_deliveries_message_id_idx" ON "mail_deliveries"("message_id");

-- AddForeignKey
ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
