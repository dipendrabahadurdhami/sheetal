// check-branch-links: proves the branch-ID links match the old branch NAMES after migration 20261111090000_branch_links.
// Where it fits: ACCESS.md section 3.4 step 4. The Lead runs it on the owner's database right after migrating, and again
// after the code switches over (P1-BE-3). It only READS; it never changes data.
// How it works: plain Node with the @prisma/client already installed (no new package). It reads DATABASE_URL from the
// shell, or from backend-core/.env (then the repo-root .env). Run from the repo root:
//     node backend-core/scripts/check-branch-links.mjs
// It prints (a) every limited member (and pending invite) whose old names and new links differ, (b) the people left with
// no branch, (c) counts. Business names and emails are masked to their first 2 letters.
// Exit code: 0 when (a) holds only stale-name rows (a name that matches no single branch, dropped on purpose);
// 1 when a row differs for any other reason (a name that should have linked but did not, or a link with no old name),
// or the database cannot be read.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const core = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.DATABASE_URL) {
  for (const f of [join(core, ".env"), join(core, "..", ".env")]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) { process.env.DATABASE_URL = m[1]; break; }
  }
}

const require = createRequire(join(core, "package.json"));
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const mask = (s) => (s ? `${String(s).slice(0, 2)}***` : "(none)");
const lowerSet = (xs) => [...new Set(xs.filter((x) => typeof x === "string").map((x) => x.toLowerCase()))].sort();

// Step 4 query of ACCESS.md, widened to also return who and what: limited people whose old names (lower-case, no
// repeats) are not the same set as the names of the branches they are linked to.
const DIFFERING = {
  members: `
    SELECT m.id, m.tenant_id, t.name AS business, u.email, m.scopes,
           coalesce((SELECT array_agg(b.name ORDER BY b.name) FROM membership_branches mb JOIN branches b ON b.id = mb.branch_id WHERE mb.membership_id = m.id), '{}') AS linked
      FROM memberships m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
     WHERE m.all_branches = false AND jsonb_typeof(m.scopes) = 'array'
       AND (SELECT coalesce(array_agg(DISTINCT lower(x) ORDER BY lower(x)), '{}') FROM jsonb_array_elements_text(m.scopes) x)
        <> (SELECT coalesce(array_agg(DISTINCT lower(b.name) ORDER BY lower(b.name)), '{}')
              FROM membership_branches mb JOIN branches b ON b.id = mb.branch_id WHERE mb.membership_id = m.id)
     ORDER BY t.name, u.email`,
  invites: `
    SELECT i.id, i.tenant_id, t.name AS business, i.email, i.scopes,
           coalesce((SELECT array_agg(b.name ORDER BY b.name) FROM invite_branches ib JOIN branches b ON b.id = ib.branch_id WHERE ib.invite_id = i.id), '{}') AS linked
      FROM invites i JOIN tenants t ON t.id = i.tenant_id
     WHERE i.all_branches = false AND i.status = 'pending' AND jsonb_typeof(i.scopes) = 'array'
       AND (SELECT coalesce(array_agg(DISTINCT lower(x) ORDER BY lower(x)), '{}') FROM jsonb_array_elements_text(i.scopes) x)
        <> (SELECT coalesce(array_agg(DISTINCT lower(b.name) ORDER BY lower(b.name)), '{}')
              FROM invite_branches ib JOIN branches b ON b.id = ib.branch_id WHERE ib.invite_id = i.id)
     ORDER BY t.name, i.email`,
};

// Why a row differs: "stale" = every missing name has no single matching branch (expected); anything else is a real problem.
async function explain(row) {
  const old = Array.isArray(row.scopes) ? row.scopes : [];
  const oldNames = lowerSet(old);
  const linked = lowerSet(row.linked);
  const extra = linked.filter((n) => !oldNames.includes(n));
  const branches = await db.$queryRawUnsafe(`SELECT name FROM branches WHERE tenant_id = $1`, row.tenant_id);
  const names = branches.map((b) => b.name);
  const problems = [];
  if (extra.length) problems.push(`linked to ${extra.join(", ")} which is not in the old list`);
  for (const missing of old.filter((n) => typeof n === "string" && !linked.includes(n.toLowerCase()))) {
    const exact = names.filter((n) => n === missing).length;
    const loose = names.filter((n) => n.toLowerCase() === missing.toLowerCase()).length;
    if (exact > 0 || loose === 1) problems.push(`"${missing}" matches a branch but has no link`);
  }
  return problems;
}

let exitCode = 0;
try {
  console.log("Branch links check\n");

  console.log("(a) Limited people whose old branch names and new links differ");
  let differing = 0;
  for (const [kind, sql] of Object.entries(DIFFERING)) {
    const rows = await db.$queryRawUnsafe(sql);
    for (const row of rows) {
      differing += 1;
      const problems = await explain(row);
      const verdict = problems.length ? `PROBLEM: ${problems.join("; ")}` : "stale name(s) dropped on purpose";
      if (problems.length) exitCode = 1;
      console.log(`  ${kind === "members" ? "member" : "pending invite"} ${row.id}  business ${mask(row.business)}  email ${mask(row.email)}`);
      console.log(`    old names: ${JSON.stringify(row.scopes)}   linked branches: ${JSON.stringify(row.linked)}   -> ${verdict}`);
    }
  }
  if (differing === 0) console.log("  none");

  console.log("\n(b) Limited people left with NO branch (they see 'You aren't given any open branch'; the owner fixes it on the Team page)");
  const none = await db.$queryRawUnsafe(`
    SELECT 'member' AS kind, m.id, t.name AS business, u.email, m.scopes
      FROM memberships m JOIN tenants t ON t.id = m.tenant_id JOIN users u ON u.id = m.user_id
     WHERE m.all_branches = false AND NOT EXISTS (SELECT 1 FROM membership_branches mb WHERE mb.membership_id = m.id)
    UNION ALL
    SELECT 'pending invite', i.id, t.name, i.email, i.scopes
      FROM invites i JOIN tenants t ON t.id = i.tenant_id
     WHERE i.all_branches = false AND i.status = 'pending' AND NOT EXISTS (SELECT 1 FROM invite_branches ib WHERE ib.invite_id = i.id)
     ORDER BY 3, 4`);
  for (const r of none) console.log(`  ${r.kind} ${r.id}  business ${mask(r.business)}  email ${mask(r.email)}  old names: ${JSON.stringify(r.scopes)}`);
  if (none.length === 0) console.log("  none");

  console.log("\n(c) Counts");
  const [c] = await db.$queryRawUnsafe(`
    SELECT (SELECT count(*) FROM memberships)::int AS members,
           (SELECT count(*) FROM memberships WHERE all_branches = false)::int AS limited_members,
           (SELECT count(*) FROM membership_branches)::int AS member_links,
           (SELECT count(*) FROM invites)::int AS invites,
           (SELECT count(*) FROM invites WHERE status = 'pending')::int AS pending_invites,
           (SELECT count(*) FROM invites WHERE all_branches = false)::int AS limited_invites,
           (SELECT count(*) FROM invite_branches)::int AS invite_links`);
  console.log(`  members: ${c.members}   limited members: ${c.limited_members}   member link rows: ${c.member_links}`);
  console.log(`  invites: ${c.invites}   pending: ${c.pending_invites}   limited: ${c.limited_invites}   invite link rows: ${c.invite_links}`);

  console.log(`\n${exitCode === 0 ? "PASS" : "FAIL"}: ${exitCode === 0 ? "every difference is a stale name dropped on purpose" : "at least one difference is not a stale name (see PROBLEM above)"}`);
} catch (e) {
  console.log(`ERROR  ${e.message}`);
  exitCode = 1;
} finally {
  await db.$disconnect();
}
process.exit(exitCode);
