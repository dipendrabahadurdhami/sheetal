-- Stage 1.3 integration_center: the tables of the Integration Center (INTEGRATIONS.md section 5).
-- ADDITIVE ONLY: five new tables, nothing dropped or changed, and NO row is inserted. Today's settings rows ("payments", "integration.google"…)
-- stay as they are; `npm run integrations:migrate` copies them into connections (sealed values are copied unopened) and deletes nothing.

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tenant_id" TEXT,
    "owner_key" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "mode" TEXT NOT NULL DEFAULT 'test',
    "config" JSONB NOT NULL,
    "staged_config" JSONB,
    "review_status" TEXT NOT NULL DEFAULT 'none',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "last_test_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "go_live_at" TIMESTAMP(3),
    "go_live_by" TEXT,
    "paused_at" TIMESTAMP(3),
    "paused_by" TEXT,
    "pause_reason" TEXT,
    "health_status" TEXT NOT NULL DEFAULT 'unknown',
    "health_message" TEXT,
    "health_checked_at" TIMESTAMP(3),
    "health_failures" INTEGER NOT NULL DEFAULT 0,
    "health_alerted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_secret_sets" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sealed" JSONB NOT NULL,
    "field_names" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_secret_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_documents" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "file_ref" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "expires_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "integration_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_test_logs" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "checks" JSONB NOT NULL,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "actor_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_test_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_guides" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_guides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_tenant_id_idx" ON "integration_connections"("tenant_id");

-- CreateIndex
CREATE INDEX "integration_connections_state_idx" ON "integration_connections"("state");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_integration_id_owner_key_key" ON "integration_connections"("integration_id", "owner_key");

-- CreateIndex
CREATE INDEX "integration_secret_sets_connection_id_mode_status_idx" ON "integration_secret_sets"("connection_id", "mode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_documents_connection_id_key_key" ON "integration_documents"("connection_id", "key");

-- CreateIndex
CREATE INDEX "integration_test_logs_connection_id_at_idx" ON "integration_test_logs"("connection_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "help_guides_key_lang_key" ON "help_guides"("key", "lang");

-- AddForeignKey
ALTER TABLE "integration_secret_sets" ADD CONSTRAINT "integration_secret_sets_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_documents" ADD CONSTRAINT "integration_documents_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_test_logs" ADD CONSTRAINT "integration_test_logs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
