-- CreateTable
CREATE TABLE "mail_domains" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verify_token" TEXT NOT NULL,
    "dkim_selector" TEXT NOT NULL DEFAULT 'sheetal',
    "dkim_public_key" TEXT NOT NULL,
    "dkim_private_key" TEXT NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '{}',
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'person',
    "user_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_access" (
    "mailbox_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "mailbox_access_pkey" PRIMARY KEY ("mailbox_id","user_id")
);

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "in_reply_to" TEXT,
    "from_address" TEXT NOT NULL,
    "from_name" TEXT,
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "html" TEXT,
    "snippet" TEXT NOT NULL DEFAULT '',
    "size" INTEGER NOT NULL DEFAULT 0,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "mail_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_domains_name_key" ON "mail_domains"("name");

-- CreateIndex
CREATE INDEX "mail_domains_tenant_id_idx" ON "mail_domains"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_address_key" ON "mailboxes"("address");

-- CreateIndex
CREATE INDEX "mailboxes_tenant_id_idx" ON "mailboxes"("tenant_id");

-- CreateIndex
CREATE INDEX "mailboxes_user_id_idx" ON "mailboxes"("user_id");

-- CreateIndex
CREATE INDEX "mailbox_access_user_id_idx" ON "mailbox_access"("user_id");

-- CreateIndex
CREATE INDEX "mail_messages_mailbox_id_folder_created_at_idx" ON "mail_messages"("mailbox_id", "folder", "created_at");

-- CreateIndex
CREATE INDEX "mail_messages_tenant_id_idx" ON "mail_messages"("tenant_id");

-- CreateIndex
CREATE INDEX "mail_messages_thread_id_idx" ON "mail_messages"("thread_id");

-- CreateIndex
CREATE INDEX "mail_messages_status_idx" ON "mail_messages"("status");

-- CreateIndex
CREATE INDEX "mail_attachments_message_id_idx" ON "mail_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "mail_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_access" ADD CONSTRAINT "mailbox_access_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
