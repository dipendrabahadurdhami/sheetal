// resync-branch-links: re-runs the P1-DB-2 backfill so the branch-ID links match the old branch NAMES again.
// Where it fits: ACCESS.md section 3.4. Between the P1-DB-2 migration and the P1-BE-3 release the OLD code kept editing `scopes` (names)
// while the new link rows stood still. The Lead runs this ONCE, right after merging P1-BE-3 (and after `db:deploy`), then runs
// `node backend-core/scripts/check-branch-links.mjs`, which must end with PASS. From that moment the code writes both, in one transaction.
// How it works: plain Node with the @prisma/client already installed (no new package). It reads DATABASE_URL from the shell, or from
// backend-core/.env (then the repo-root .env). The statements are NOT copied here: they are read from the migration file, between its
// "-- BACKFILL START" and "-- BACKFILL END" markers, so there is one source of truth. In ONE transaction it (1) empties membership_branches
// and invite_branches, because the backfill only adds rows and would keep rows for branches that were taken away from a person, then
// (2) runs the backfill, which recomputes every all_branches flag from `scopes` (owners always true) and inserts one row per branch name.
// Run from the repo root:
//     node backend-core/scripts/resync-branch-links.mjs --dry-run     (changes nothing: shows what would change, then rolls back)
//     node backend-core/scripts/resync-branch-links.mjs               (does it)
// Rules: safe to run twice (same result). It never widens anyone: a limited person whose names match no branch ends with no branch and
// stays limited, as in the migration. Stale names are reported by check-branch-links.mjs (the database notices of the DO block are not
// shown by Prisma). Exit code 0 when done, 1 on any error (then nothing was changed).
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const core = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

if (!process.env.DATABASE_URL) {
  for (const f of [join(core, ".env"), join(core, "..", ".env")]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) { process.env.DATABASE_URL = m[1]; break; }
  }
}

// The backfill, read from the migration that created the tables.
const migration = join(core, "prisma", "migrations", "20261111090000_branch_links", "migration.sql");
const sql = readFileSync(migration, "utf8");
const start = sql.indexOf("-- BACKFILL START");
const end = sql.indexOf("-- BACKFILL END");
if (start < 0 || end < start) {
  console.log(`ERROR  the BACKFILL START / BACKFILL END markers are not in ${migration}`);
  process.exit(1);
}
const backfill = sql.slice(start + "-- BACKFILL START".length, end).trim();

const require = createRequire(join(core, "package.json"));
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const COUNTS = `
  SELECT (SELECT count(*) FROM memberships)::int AS members,
         (SELECT count(*) FROM memberships WHERE all_branches = false)::int AS limited_members,
         (SELECT count(*) FROM membership_branches)::int AS member_links,
         (SELECT count(*) FROM invites WHERE status = 'pending')::int AS pending_invites,
         (SELECT count(*) FROM invites WHERE status = 'pending' AND all_branches = false)::int AS limited_invites,
         (SELECT count(*) FROM invite_branches)::int AS invite_links`;
// Who has which branch, as a comparable text: used to say how many people's access changed.
const SIGNATURE = `
  SELECT m.id, m.all_branches AS flag, coalesce((SELECT string_agg(mb.branch_id, ',' ORDER BY mb.branch_id) FROM membership_branches mb WHERE mb.membership_id = m.id), '') AS links
    FROM memberships m
  UNION ALL
  SELECT i.id, i.all_branches, coalesce((SELECT string_agg(ib.branch_id, ',' ORDER BY ib.branch_id) FROM invite_branches ib WHERE ib.invite_id = i.id), '')
    FROM invites i WHERE i.status = 'pending'`;

const show = (label, c) => console.log(`  ${label}: members ${c.members} (limited ${c.limited_members}, link rows ${c.member_links})   pending invites ${c.pending_invites} (limited ${c.limited_invites}, link rows ${c.invite_links})`);
const bySig = (rows) => new Map(rows.map((r) => [r.id, `${r.flag}|${r.links}`]));

class DryRun extends Error {}

try {
  console.log(`Resync of branch links${dryRun ? " (dry run: nothing will be saved)" : ""}\n`);
  let before; let after; let changed = 0;
  const work = async (tx) => {
    before = (await tx.$queryRawUnsafe(COUNTS))[0];
    const sigBefore = bySig(await tx.$queryRawUnsafe(SIGNATURE));
    await tx.$executeRawUnsafe(`DELETE FROM "membership_branches"`);
    await tx.$executeRawUnsafe(`DELETE FROM "invite_branches"`);
    await tx.$executeRawUnsafe(backfill);
    after = (await tx.$queryRawUnsafe(COUNTS))[0];
    const sigAfter = bySig(await tx.$queryRawUnsafe(SIGNATURE));
    for (const [id, sig] of sigAfter) if (sigBefore.get(id) !== sig) changed += 1;
    if (dryRun) throw new DryRun();
  };
  try {
    await db.$transaction(work, { timeout: 120_000, maxWait: 20_000 });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  show("before", before);
  show("after ", after);
  console.log(`\n  people (and pending invitations) whose branch access changed: ${changed}`);
  console.log(dryRun ? "\nDRY RUN: rolled back, nothing was changed." : "\nDONE. Now run: node backend-core/scripts/check-branch-links.mjs   (it must end with PASS)");
  await db.$disconnect();
  process.exit(0);
} catch (e) {
  console.log(`ERROR  ${e.message}\nNothing was changed.`);
  await db.$disconnect().catch(() => {});
  process.exit(1);
}
