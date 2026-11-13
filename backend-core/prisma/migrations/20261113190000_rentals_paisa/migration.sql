-- P2-W6 leftover: Rentals money in paisa. Additive: new nullable BIGINT columns, filled from today's whole rupees (× 100), and kept equal to them by a
-- BEFORE INSERT OR UPDATE trigger, so every writer (the Rentals app, online rent payments, statements, bill increments) stays right without a code change.
-- Readers keep using rupees until Phase 3 switches them to paisa. Safe to run twice: the UPDATEs only fill NULLs, CREATE OR REPLACE / DROP IF EXISTS for the triggers.

ALTER TABLE "rent_units" ADD COLUMN "rent_paisa" BIGINT;
UPDATE "rent_units" SET "rent_paisa" = "rent"::BIGINT * 100 WHERE "rent_paisa" IS NULL;
CREATE OR REPLACE FUNCTION "rent_units_paisa_sync"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."rent_paisa" := NEW."rent"::BIGINT * 100; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "rent_units_paisa_sync" ON "rent_units";
CREATE TRIGGER "rent_units_paisa_sync" BEFORE INSERT OR UPDATE ON "rent_units" FOR EACH ROW EXECUTE FUNCTION "rent_units_paisa_sync"();

ALTER TABLE "rent_leases" ADD COLUMN "rent_paisa" BIGINT, ADD COLUMN "deposit_paisa" BIGINT, ADD COLUMN "deposit_returned_paisa" BIGINT;
UPDATE "rent_leases" SET "rent_paisa" = "rent"::BIGINT * 100, "deposit_paisa" = "deposit"::BIGINT * 100, "deposit_returned_paisa" = "deposit_returned"::BIGINT * 100 WHERE "rent_paisa" IS NULL OR "deposit_paisa" IS NULL OR "deposit_returned_paisa" IS NULL;
CREATE OR REPLACE FUNCTION "rent_leases_paisa_sync"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."rent_paisa" := NEW."rent"::BIGINT * 100; NEW."deposit_paisa" := NEW."deposit"::BIGINT * 100; NEW."deposit_returned_paisa" := NEW."deposit_returned"::BIGINT * 100; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "rent_leases_paisa_sync" ON "rent_leases";
CREATE TRIGGER "rent_leases_paisa_sync" BEFORE INSERT OR UPDATE ON "rent_leases" FOR EACH ROW EXECUTE FUNCTION "rent_leases_paisa_sync"();

ALTER TABLE "rent_bills" ADD COLUMN "amount_paisa" BIGINT, ADD COLUMN "late_fee_paisa" BIGINT, ADD COLUMN "paid_paisa" BIGINT;
UPDATE "rent_bills" SET "amount_paisa" = "amount"::BIGINT * 100, "late_fee_paisa" = "late_fee"::BIGINT * 100, "paid_paisa" = "paid"::BIGINT * 100 WHERE "amount_paisa" IS NULL OR "late_fee_paisa" IS NULL OR "paid_paisa" IS NULL;
CREATE OR REPLACE FUNCTION "rent_bills_paisa_sync"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."amount_paisa" := NEW."amount"::BIGINT * 100; NEW."late_fee_paisa" := NEW."late_fee"::BIGINT * 100; NEW."paid_paisa" := NEW."paid"::BIGINT * 100; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "rent_bills_paisa_sync" ON "rent_bills";
CREATE TRIGGER "rent_bills_paisa_sync" BEFORE INSERT OR UPDATE ON "rent_bills" FOR EACH ROW EXECUTE FUNCTION "rent_bills_paisa_sync"();

ALTER TABLE "rent_payments" ADD COLUMN "amount_paisa" BIGINT;
UPDATE "rent_payments" SET "amount_paisa" = "amount"::BIGINT * 100 WHERE "amount_paisa" IS NULL;
CREATE OR REPLACE FUNCTION "rent_payments_paisa_sync"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."amount_paisa" := NEW."amount"::BIGINT * 100; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "rent_payments_paisa_sync" ON "rent_payments";
CREATE TRIGGER "rent_payments_paisa_sync" BEFORE INSERT OR UPDATE ON "rent_payments" FOR EACH ROW EXECUTE FUNCTION "rent_payments_paisa_sync"();

ALTER TABLE "rent_repairs" ADD COLUMN "cost_paisa" BIGINT;
UPDATE "rent_repairs" SET "cost_paisa" = "cost"::BIGINT * 100 WHERE "cost_paisa" IS NULL;
CREATE OR REPLACE FUNCTION "rent_repairs_paisa_sync"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."cost_paisa" := NEW."cost"::BIGINT * 100; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "rent_repairs_paisa_sync" ON "rent_repairs";
CREATE TRIGGER "rent_repairs_paisa_sync" BEFORE INSERT OR UPDATE ON "rent_repairs" FOR EACH ROW EXECUTE FUNCTION "rent_repairs_paisa_sync"();

ALTER TABLE "owner_statements" ADD COLUMN "collected_paisa" BIGINT, ADD COLUMN "fee_paisa" BIGINT, ADD COLUMN "repairs_paisa" BIGINT, ADD COLUMN "payable_paisa" BIGINT;
UPDATE "owner_statements" SET "collected_paisa" = "collected"::BIGINT * 100, "fee_paisa" = "fee"::BIGINT * 100, "repairs_paisa" = "repairs"::BIGINT * 100, "payable_paisa" = "payable"::BIGINT * 100 WHERE "collected_paisa" IS NULL OR "fee_paisa" IS NULL OR "repairs_paisa" IS NULL OR "payable_paisa" IS NULL;
CREATE OR REPLACE FUNCTION "owner_statements_paisa_sync"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."collected_paisa" := NEW."collected"::BIGINT * 100; NEW."fee_paisa" := NEW."fee"::BIGINT * 100; NEW."repairs_paisa" := NEW."repairs"::BIGINT * 100; NEW."payable_paisa" := NEW."payable"::BIGINT * 100; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS "owner_statements_paisa_sync" ON "owner_statements";
CREATE TRIGGER "owner_statements_paisa_sync" BEFORE INSERT OR UPDATE ON "owner_statements" FOR EACH ROW EXECUTE FUNCTION "owner_statements_paisa_sync"();
