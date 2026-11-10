-- Expenses paisa resync (P1-BE-5). DATA ONLY: no table or column is created, changed or dropped.
-- Why: the kernel_base migration (P1-DB-1) filled amount_paisa for the rows that existed THEN. Expenses written after it, by the code that did not know the
-- column yet, have amount_paisa NULL. From P1-BE-5 the app writes both columns, and reads paisa; this fills the rows still empty, once, before it goes live.
-- Safe to run twice: it only touches rows where amount_paisa IS NULL, and never changes a row that already has a value.
-- Same two statements as kernel_base lines 48-49 (whole rupees x 100).
UPDATE "expenses" SET "amount_paisa" = "amount"::BIGINT * 100 WHERE "amount_paisa" IS NULL;
UPDATE "recurring_expenses" SET "amount_paisa" = "amount"::BIGINT * 100 WHERE "amount_paisa" IS NULL;
