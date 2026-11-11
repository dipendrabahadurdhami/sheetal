-- P1-DB-3 access_tables: the tables for permissions v2, approvals and impersonation (ACCESS.md sections 6.3, 9.3 and 12).
-- ADDITIVE ONLY: nothing is dropped, renamed or changed, and NO row is inserted (every approval rule is off because none exists).
--   1. roles.perms_v1: the backup of a role's old permission names. Empty until scripts/rewrite-role-perms.mjs --apply fills it.
--   2. approval_rules and approval_requests (maker-checker, workspace app)
--   3. impersonation_sessions (the "log in as them" trail, platform app)
-- The role rewrite itself is NOT here: it is a script with a dry run and a proof (backend-core/scripts/rewrite-role-perms.mjs).

-- ───────────── 1. Role backup column ─────────────

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "perms_v1" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ───────────── 2. Approvals ─────────────

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "threshold_paisa" BIGINT,
    "approver_permission" TEXT NOT NULL,
    "expires_hours" INTEGER NOT NULL DEFAULT 72,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "payload" JSONB NOT NULL,
    "amount_paisa" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "maker_id" TEXT NOT NULL,
    "maker_note" TEXT NOT NULL DEFAULT '',
    "checker_id" TEXT,
    "checker_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_rules_tenant_id_action_key" ON "approval_rules"("tenant_id", "action");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_status_created_at_idx" ON "approval_requests"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_status_expires_at_idx" ON "approval_requests"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The status is a text column with a CHECK, not an enum: the list of states may grow in Phase 2, and changing a CHECK is one
-- plain statement inside a migration, whereas adding a value to a PostgreSQL enum cannot be undone and cannot be used in the
-- same transaction. Prisma does not know about CHECK constraints; the schema comment on the model names the seven words.
-- No foreign key on branch_id (a label: an approval never blocks deleting a branch) nor on maker_id / checker_id (the record
-- outlives the person, like audit_logs.actor_id).
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_status_check"
  CHECK ("status" IN ('pending', 'approved', 'executed', 'failed', 'rejected', 'cancelled', 'expired'));

-- ───────────── 3. Impersonation trail ─────────────

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "ended_by" TEXT,
    "read_only" BOOLEAN NOT NULL DEFAULT true,
    "ip" TEXT,
    "request_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impersonation_sessions_tenant_id_ended_at_idx" ON "impersonation_sessions"("tenant_id", "ended_at");

-- CreateIndex
CREATE INDEX "impersonation_sessions_staff_id_ended_at_idx" ON "impersonation_sessions"("staff_id", "ended_at");

-- The trail must survive. RESTRICT on the staff user: a staff member who has sessions cannot be deleted (suspend them instead),
-- so the record of who looked into a business is never erased by a clean-up. SET NULL on the business: if the business is
-- deleted (the daily demo cleanup does this) the session row stays; only tenant_id is emptied, and the platform audit log
-- rows impersonation.started / impersonation.ended still name the business.
-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
