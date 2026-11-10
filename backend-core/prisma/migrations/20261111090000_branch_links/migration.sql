-- P1-DB-2 branch_links: people-to-branch links by branch ID (ACCESS.md section 3.4, steps 1 and 2).
-- ADDITIVE ONLY: nothing is dropped, renamed or changed. The old "scopes" column (branch NAMES) stays exactly as it is and
-- the current code keeps using it; the new rows are read and written by the code in task P1-BE-3.
--   1. memberships.all_branches and invites.all_branches (true = every branch, now and in future)
--   2. Two join tables: membership_branches and invite_branches (both foreign keys ON DELETE CASCADE)
--   3. Backfill: every name in "scopes" becomes a branch-id row (one DO block, safe to run twice)
-- To see the result on a real database, run: node backend-core/scripts/check-branch-links.mjs

-- ───────────── 1. Columns ─────────────

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN "all_branches" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "invites" ADD COLUMN "all_branches" BOOLEAN NOT NULL DEFAULT true;

-- ───────────── 2. Join tables ─────────────

-- CreateTable
CREATE TABLE "membership_branches" (
    "membership_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "membership_branches_pkey" PRIMARY KEY ("membership_id","branch_id")
);

-- CreateTable
CREATE TABLE "invite_branches" (
    "invite_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "invite_branches_pkey" PRIMARY KEY ("invite_id","branch_id")
);

-- CreateIndex
CREATE INDEX "membership_branches_branch_id_idx" ON "membership_branches"("branch_id");

-- CreateIndex
CREATE INDEX "invite_branches_branch_id_idx" ON "invite_branches"("branch_id");

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_branches" ADD CONSTRAINT "membership_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_branches" ADD CONSTRAINT "invite_branches_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_branches" ADD CONSTRAINT "invite_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── 3. Backfill ─────────────
-- The test (test/branch-links.test.ts) reads everything between the two BACKFILL markers and runs it as ONE statement,
-- so keep this section a single DO block. The rules (ACCESS.md 3.4, edge-case table):
--   "all", null, a missing value, or anything that is not a list  -> all_branches = true
--   a business owner (role perms contain '*')                      -> all_branches = true, whatever "scopes" says
--   a list                                                         -> all_branches = false, one row per branch it names
--   a name that matches no branch of that business (stale)         -> dropped, reported with RAISE NOTICE
--   a person left with zero branches                               -> stays all_branches = false with no rows (NEVER
--                                                                     widened to all); reported with RAISE NOTICE
--   a closed branch in the list                                    -> kept
--   invitations: every row gets all_branches, only 'pending' rows get link rows
-- Matching a name: an exact match wins; otherwise a case-insensitive match is used only when exactly ONE branch of the
-- business matches. (The database only forbids two branches with the SAME name; "Lakeside" and "lakeside" can both
-- exist, and guessing between them could give access to the wrong one, so that name is treated as stale.)
-- Safe to run twice: the flags are recomputed from "scopes" each time and the rows are inserted with ON CONFLICT DO NOTHING.
-- Only run it again while "scopes" is still kept in step with the rows (before the freeze, step 5).

-- BACKFILL START
DO $backfill$
DECLARE
  v_row     record;
  v_branch  text;
  v_hits    integer;
  v_linked  integer := 0;
  v_stale   integer := 0;
  v_count   integer;
  v_ids     text;
BEGIN
  -- 1. Flags. false only for a non-owner whose scopes is a list.
  UPDATE "memberships" m
     SET "all_branches" = (
           jsonb_typeof(m."scopes") IS DISTINCT FROM 'array'
           OR EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = m."role_id" AND '*' = ANY (r."perms"))
         );

  UPDATE "invites" i
     SET "all_branches" = (
           jsonb_typeof(i."scopes") IS DISTINCT FROM 'array'
           OR EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = i."role_id" AND '*' = ANY (r."perms"))
         );

  -- 2. Members: names -> branch ids.
  FOR v_row IN
    SELECT m."id" AS member_id, m."tenant_id" AS tenant_id, s.name AS name
      FROM "memberships" m
     CROSS JOIN LATERAL jsonb_array_elements_text(m."scopes") AS s(name)
     WHERE m."all_branches" = false AND jsonb_typeof(m."scopes") = 'array'
  LOOP
    v_branch := NULL;
    IF v_row.name IS NOT NULL THEN
      SELECT b."id" INTO v_branch FROM "branches" b
       WHERE b."tenant_id" = v_row.tenant_id AND b."name" = v_row.name;
      IF v_branch IS NULL THEN
        SELECT count(*), min(b."id") INTO v_hits, v_branch FROM "branches" b
         WHERE b."tenant_id" = v_row.tenant_id AND lower(b."name") = lower(v_row.name);
        IF v_hits <> 1 THEN v_branch := NULL; END IF;
      END IF;
    END IF;

    IF v_branch IS NULL THEN
      v_stale := v_stale + 1;
      RAISE NOTICE 'P1-DB-2 stale branch name dropped: member % (business %) had %', v_row.member_id, v_row.tenant_id, coalesce(v_row.name, '(empty)');
    ELSE
      INSERT INTO "membership_branches" ("membership_id", "branch_id") VALUES (v_row.member_id, v_branch)
        ON CONFLICT DO NOTHING;
      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  -- 3. Pending invitations: the same.
  FOR v_row IN
    SELECT i."id" AS invite_id, i."tenant_id" AS tenant_id, s.name AS name
      FROM "invites" i
     CROSS JOIN LATERAL jsonb_array_elements_text(i."scopes") AS s(name)
     WHERE i."all_branches" = false AND jsonb_typeof(i."scopes") = 'array' AND i."status" = 'pending'
  LOOP
    v_branch := NULL;
    IF v_row.name IS NOT NULL THEN
      SELECT b."id" INTO v_branch FROM "branches" b
       WHERE b."tenant_id" = v_row.tenant_id AND b."name" = v_row.name;
      IF v_branch IS NULL THEN
        SELECT count(*), min(b."id") INTO v_hits, v_branch FROM "branches" b
         WHERE b."tenant_id" = v_row.tenant_id AND lower(b."name") = lower(v_row.name);
        IF v_hits <> 1 THEN v_branch := NULL; END IF;
      END IF;
    END IF;

    IF v_branch IS NULL THEN
      v_stale := v_stale + 1;
      RAISE NOTICE 'P1-DB-2 stale branch name dropped: pending invite % (business %) had %', v_row.invite_id, v_row.tenant_id, coalesce(v_row.name, '(empty)');
    ELSE
      INSERT INTO "invite_branches" ("invite_id", "branch_id") VALUES (v_row.invite_id, v_branch)
        ON CONFLICT DO NOTHING;
      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  -- 4. Report: limited people (and pending invitations) who ended with no branch. They are NOT widened to "all".
  SELECT count(*), string_agg(m."id", ', ') INTO v_count, v_ids FROM "memberships" m
   WHERE m."all_branches" = false
     AND NOT EXISTS (SELECT 1 FROM "membership_branches" mb WHERE mb."membership_id" = m."id");
  IF v_count > 0 THEN
    RAISE NOTICE 'P1-DB-2 members with NO branch left (still limited, owner must fix on the Team page): % -> %', v_count, v_ids;
  END IF;

  SELECT count(*), string_agg(i."id", ', ') INTO v_count, v_ids FROM "invites" i
   WHERE i."all_branches" = false AND i."status" = 'pending'
     AND NOT EXISTS (SELECT 1 FROM "invite_branches" ib WHERE ib."invite_id" = i."id");
  IF v_count > 0 THEN
    RAISE NOTICE 'P1-DB-2 pending invites with NO branch left: % -> %', v_count, v_ids;
  END IF;

  RAISE NOTICE 'P1-DB-2 branch links: % link(s) matched, % stale name(s) dropped', v_linked, v_stale;
END
$backfill$;
-- BACKFILL END
