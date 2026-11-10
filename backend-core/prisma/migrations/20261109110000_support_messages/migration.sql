/*
  Support tables for "Message Sheetal" (Business -> Help, Admin -> Inbox -> Support).

  support_tickets and support_messages were used by the code but never created. This migration only creates them
  (plus their two enums, indexes and foreign keys). It does not touch any other table.
*/

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('open', 'waiting', 'closed');

-- CreateEnum
CREATE TYPE "SupportFrom" AS ENUM ('business', 'staff', 'note');

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'open',
    "assignee_id" TEXT,
    "last_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_by_business_at" TIMESTAMP(3),
    "read_by_staff_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "from" "SupportFrom" NOT NULL,
    "user_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_seq_key" ON "support_tickets"("seq");

-- CreateIndex
CREATE INDEX "support_tickets_tenant_id_last_at_idx" ON "support_tickets"("tenant_id", "last_at");

-- CreateIndex
CREATE INDEX "support_tickets_tenant_id_user_id_last_at_idx" ON "support_tickets"("tenant_id", "user_id", "last_at");

-- CreateIndex
CREATE INDEX "support_tickets_status_last_at_idx" ON "support_tickets"("status", "last_at");

-- CreateIndex
CREATE INDEX "support_tickets_assignee_id_last_at_idx" ON "support_tickets"("assignee_id", "last_at");

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
