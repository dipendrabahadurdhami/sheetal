-- Business settings that are not columns: payments, notifications, listing defaults, documents, receipts and
-- listing check-ups, one JSON object per section (secrets inside are sealed with SECRETS_KEY).
ALTER TABLE "tenants" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
