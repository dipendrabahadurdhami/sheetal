// rewrite-role-perms: moves every business role from the OLD permission names to the NEW ones, with proof that nobody gains or loses access.
// Where it fits: ACCESS.md section 6.3 step 2 and section 5.4. NOT a migration: a script you can look at first (--dry-run), run (--apply)
// and undo (--restore). The Lead runs it on the owner's data only after QA and the Lead approved the dry run, with a backup first.
// How it works: plain Node with the @prisma/client already installed (no new package). DATABASE_URL comes from the shell, else backend-core/.env,
// else the root .env. Run from the repo root:
//     node backend-core/scripts/rewrite-role-perms.mjs                 (= --dry-run: prints what would change per business and role, writes nothing)
//     node backend-core/scripts/rewrite-role-perms.mjs --apply         (writes, in ONE transaction)
//     node backend-core/scripts/rewrite-role-perms.mjs --restore       (puts roles.perms_v1 back into roles.perms; --force if a role was edited since)
//     add --verbose to print every new list; add --business=ID[,ID] to act on those businesses only (try one first)
// What it does to a role (system AND custom): every old name becomes its new names (LEGACY_ALIASES, read from
// platform/src/tenancy/permissions.generated.ts, the same file the servers use; nothing is copied by hand), each with a ":scope" suffix =
// the manifest default of that permission. "*" stays "*". Names already new are kept. Unknown names are kept and reported.
// Lead decision (ACCESS.md 5.4): a role that holds leads.view AND leads.assign gets crm.lead.read:branch + crm.lead.assign:branch; leads.view alone gets crm.lead.read:own.
// roles.perms_v1 gets the old list, only when it is empty (running twice never overwrites the backup).
// THE PROOF: before writing, for every changed role and for EVERY old name and EVERY new business name in the catalogs, it asks
// hasPerm(before, name) and hasPerm(after, name), with the server rule AND the screens' rule (shared/src/core/rbac.js).
//   - a name that goes true -> false (access LOST): --apply refuses, always;
//   - a name that goes false -> true (access GAINED): --apply refuses unless the name is on ALLOWED_WIDENING below;
//   - the server and the screens giving different answers: --apply refuses.
// The proof checks names, not data scopes: crm.lead.read:own for a leads.view-only role narrows what the role SEES by design (today's code
// already shows such roles only their own and unassigned leads), it does not change whether the role holds the permission.
// Ends with a summary line and PASS or FAIL (exit code 0 / 1), like check-branch-links.mjs. Business names are masked to 2 letters plus the id.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const core = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(core, "..");
const GENERATED = join(root, "platform", "src", "tenancy", "permissions.generated.ts");
const SCREENS = join(root, "shared", "src", "core", "rbac.js");

/**
 * Names that MAY go from "not held" to "held" for a role (the widening allow-list). Each is a "view" name whose new name is also part of the
 * matching "manage" name in LEGACY_ALIASES (ACCESS.md 6.1: team.manage = read + invite + update + remove; invoices.create = read + create; ...).
 * A role that held the manage name but not the view name (an unusual custom role) ends up holding the READ permission after the rewrite,
 * because the new model has no way to say "may change but may not see". The alternative, keeping the role "blind", is impossible in the new
 * names; so the role gains only the ability to read what it can already change. Every such role is printed by the dry run, and the Lead can
 * delete a name from this list to make --apply refuse until the owner has decided about the roles named.
 */
export const ALLOWED_WIDENING = [
  "team.view",       // team.manage includes workspace.team.read
  "invoices.view",   // invoices.create includes invoicing.invoice.read
  "people.view",     // people.manage includes people.person.read
  "rentals.view",    // rentals.manage includes rentals.rental.read
  "expenses.view",   // expenses.manage includes expenses.expense.read, expenses.recurring.read, expenses.profit.read
];

// ───────────── Reading the generated catalogs (the same file the servers use) ─────────────

/** Evaluates `export const NAME ... = <literal>` from the generated TypeScript file. The literals are plain data. */
export function readExport(src, name) {
  const m = new RegExp(`export const ${name}\\b[^=]*=\\s*`).exec(src);
  if (!m) throw new Error(`${name} not found in permissions.generated.ts`);
  const start = m.index + m[0].length;
  const open = src[start];
  if (open !== "{" && open !== "[") throw new Error(`${name} is not an object or a list`);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < src.length && src[i] !== c; i += 1) if (src[i] === "\\") i += 1;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 1;
    } else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return vm.runInNewContext(`(${src.slice(start, i + 1)})`);
    }
  }
  throw new Error(`${name}: the literal does not end`);
}

export function loadCatalogs(file = GENERATED) {
  const src = readFileSync(file, "utf8");
  const aliases = readExport(src, "LEGACY_ALIASES");
  const platformAliases = readExport(src, "LEGACY_PLATFORM_ALIASES");
  const catalog = readExport(src, "PERMISSION_CATALOG");
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const businessNames = catalog.filter((p) => p.app !== "platform").map((p) => p.id);
  return { aliases, platformAliases, catalog, byId, businessNames, oldNames: Object.keys(aliases) };
}

// ───────────── The permission check (the same rule as platform/src/tenancy/aliases.ts; a test runs both on the same cases) ─────────────

export function makeHasPerm(aliasMaps) {
  const oldToNew = new Map();
  const newToOld = new Map();
  for (const map of aliasMaps) {
    for (const [old, news] of Object.entries(map)) {
      oldToNew.set(old, [...(oldToNew.get(old) || []), news]);
      for (const n of news) newToOld.set(n, [...(newToOld.get(n) || []), old]);
    }
  }
  const holds = (perms, name) => perms.some((p) => p === name || (p.length > name.length && p.charCodeAt(name.length) === 58 && p.startsWith(name)));
  return (perms, perm) => {
    if (perms.includes("*") || holds(perms, perm)) return true;
    const sets = oldToNew.get(perm);
    if (sets && sets.some((set) => set.every((n) => holds(perms, n)))) return true;
    const olds = newToOld.get(perm);
    return !!olds && olds.some((o) => holds(perms, o));
  };
}

// ───────────── The rewrite of one role ─────────────

const RANK = { own: 0, branch: 1, all: 2 };
const splitScope = (entry) => { const i = entry.indexOf(":"); return i < 0 ? [entry, null] : [entry.slice(0, i), entry.slice(i + 1)]; };

/**
 * Old names -> new names with scope suffixes. Returns { perms, unknown }.
 * Pure: same input, same output; applying it to its own output changes nothing.
 */
export function rewritePerms(perms, cat) {
  if (perms.includes("*")) return { perms: [...perms], unknown: [] };
  const hasAssign = perms.some((e) => splitScope(e)[0] === "leads.assign");
  const out = new Map();                       // new name -> entry text, in order of first appearance
  const unknown = [];
  const put = (name, scope, text = scope ? `${name}:${scope}` : name) => {   // scope null = bare name (the manifest default applies)
    const info = cat.byId.get(name);
    const rankOf = (s) => RANK[s ?? info?.default ?? "all"] ?? 2;
    const have = out.get(name);
    if (have === undefined || rankOf(scope) > rankOf(have.scope)) out.set(name, { text, scope });   // the wider scope wins; never narrow
  };
  for (const entry of perms) {
    const [base, given] = splitScope(entry);
    const news = cat.aliases[base];
    if (news) {
      for (const n of news) {
        const info = cat.byId.get(n);
        let scope = given && info?.scopes?.includes(given) ? given : info?.default ?? null;
        if (base === "leads.view" && n === "crm.lead.read") scope = hasAssign ? "branch" : "own";   // Lead decision, ACCESS.md 5.4
        put(n, scope);
      }
    } else if (cat.byId.has(base)) {
      put(base, given, entry);                  // already a new name: kept exactly as written
    } else {
      unknown.push(entry);
      put(entry, null, entry);                  // kept as it is
    }
  }
  return { perms: [...out.values()].map((v) => v.text), unknown };
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const mask = (s) => (s ? `${String(s).slice(0, 2)}***` : "(none)");

// ───────────── The proof ─────────────

export function prove(roles, cat, checks) {
  const names = [...new Set([...cat.oldNames, ...cat.businessNames])];
  const widen = [];
  const narrow = [];
  const disagree = [];
  for (const r of roles) {
    for (const name of names) {
      const answers = checks.map((c) => [c.label, c.fn(r.before, name), c.fn(r.after, name)]);
      const [, was, now] = answers[0];
      for (const [label, w, n] of answers) if (w !== was || n !== now) disagree.push({ role: r, name, detail: `${label}: ${w} -> ${n}, ${answers[0][0]}: ${was} -> ${now}` });
      if (!was && now) widen.push({ role: r, name });
      if (was && !now) narrow.push({ role: r, name });
    }
  }
  return { widen, narrow, disagree };
}

// ───────────── The run ─────────────

const ROLES_SQL = (lock, only) => `
  SELECT r.id, r.tenant_id AS "tenantId", r.key, r.name, r.system, r.perms, coalesce(r.perms_v1, '{}') AS "permsV1", t.name AS business, t.type
    FROM roles r JOIN tenants t ON t.id = r.tenant_id${only ? "\n   WHERE r.tenant_id = ANY ($1::text[])" : ""}
   ORDER BY t.name, t.id, r.system DESC, r.key${lock ? " FOR UPDATE OF r" : ""}`;

/**
 * Runs one mode on a client that is ALREADY inside a transaction (the command line opens it; the tests open their own and roll it back).
 * `db` needs $queryRawUnsafe and $executeRawUnsafe. Returns { exitCode, ... }; throws only on a database error (the caller's transaction then rolls back).
 */
export async function runRewrite(db, { mode = "dry-run", force = false, verbose = false, only = null, allowed: allowedList = ALLOWED_WIDENING, log = console.log, catalogs, screens } = {}) {
  const cat = catalogs ?? loadCatalogs();
  const server = makeHasPerm([cat.aliases, cat.platformAliases]);
  const checks = [{ label: "server", fn: server }];
  if (screens) checks.push({ label: "screens", fn: screens });
  else log("WARNING  the screens' rule (shared/src/core/rbac.js) was not loaded; only the server rule is proved.");

  const rows = await (only ? db.$queryRawUnsafe(ROLES_SQL(mode !== "dry-run", true), only) : db.$queryRawUnsafe(ROLES_SQL(mode !== "dry-run", false)));
  const label = (r) => `${mask(r.business)} (${String(r.tenantId).slice(0, 8)})`;
  let exitCode = 0;
  const problems = [];

  log(`Role permissions: ${mode}${only ? `  (only business ${only.join(", ")})` : ""}\n`);

  // 1. The plan for every role.
  const plans = rows.map((r) => {
    if (mode === "restore") {
      const backup = r.permsV1;
      const edited = backup.length > 0 && !sameList(rewritePerms(backup, cat).perms, r.perms) && !sameList(backup, r.perms);
      return { ...r, before: r.perms, after: backup.length ? backup : r.perms, unknown: [], changed: backup.length > 0 && !sameList(backup, r.perms), edited };
    }
    const { perms: after, unknown } = rewritePerms(r.perms, cat);
    return { ...r, before: r.perms, after, unknown, changed: !sameList(after, r.perms), edited: false };
  });
  const changed = plans.filter((p) => p.changed);

  // 2. Print per business and role.
  let lastBusiness = null;
  for (const p of plans) {
    if (p.tenantId !== lastBusiness) { log(`${label(p)}  type ${p.type}`); lastBusiness = p.tenantId; }
    const kind = p.system ? "system" : "custom";
    if (p.before.includes("*")) { log(`  ${p.key} [${kind}]  "*" stays "*"`); continue; }
    if (!p.changed) { log(`  ${p.key} [${kind}]  nothing to change (${p.before.length} names)`); }
    else {
      const scopes = { own: 0, branch: 0, all: 0, none: 0 };
      for (const e of p.after) { const s = splitScope(e)[1]; scopes[s ?? "none"] += 1; }
      log(`  ${p.key} [${kind}]  ${p.before.length} names -> ${p.after.length}  (own ${scopes.own}, branch ${scopes.branch}, all ${scopes.all}, bare ${scopes.none})${p.edited ? "  EDITED since the rewrite" : ""}`);
      if (verbose) log(`      before: ${p.before.join(", ")}\n      after:  ${p.after.join(", ")}`);
    }
    if (p.unknown.length) log(`      kept unknown name(s): ${p.unknown.join(", ")}`);
  }
  if (plans.length === 0) log("  (no roles)");

  // 3. The proof.
  log("\nProof: for every changed role, every old name and every new business name, before vs after");
  const proof = prove(changed, cat, checks);
  const allowed = new Set(allowedList);
  let allowedCount = 0;
  let blocked = 0;
  for (const d of proof.disagree) { blocked += 1; log(`  DISAGREE  ${label(d.role)} / ${d.role.key}: ${d.name}  (${d.detail})`); }
  for (const d of proof.narrow) { blocked += 1; log(`  LOSES     ${label(d.role)} / ${d.role.key}: ${d.name}  true -> false`); }
  for (const d of proof.widen) {
    const ok = allowed.has(d.name);
    if (ok) allowedCount += 1; else blocked += 1;
    log(`  GAINS     ${label(d.role)} / ${d.role.key}: ${d.name}  false -> true  ${ok ? "(allowed: the role already holds the matching 'manage' permission)" : "(NOT on the allow-list)"}`);
  }
  if (proof.disagree.length + proof.narrow.length + proof.widen.length === 0) log("  no difference");
  if (blocked > 0) problems.push(`${blocked} difference(s) block ${mode === "restore" ? "nothing (information only for --restore)" : "--apply"}`);

  // 4. Restore: refuse to overwrite edits made since the rewrite, unless --force.
  const edited = plans.filter((p) => p.edited);
  if (mode === "restore" && edited.length > 0 && !force) {
    problems.push(`${edited.length} role(s) were edited after the rewrite; --restore would lose those edits (use --force)`);
    exitCode = 1;
  }
  if (mode !== "restore" && blocked > 0) exitCode = 1;
  if (mode !== "dry-run" && exitCode === 1) {
    log(`\nFAIL: nothing written. ${problems.join("; ")}`);
    return { exitCode, plans, proof, written: 0, problems };
  }

  // 5. Write (apply / restore), then check inside the same transaction.
  let written = 0;
  if (mode === "apply") {
    for (const p of changed) {
      await db.$executeRawUnsafe(
        `UPDATE roles SET perms = $1::text[], perms_v1 = CASE WHEN coalesce(cardinality(perms_v1), 0) = 0 THEN $2::text[] ELSE perms_v1 END WHERE id = $3`,
        p.after, p.before, p.id,
      );
      written += 1;
    }
  } else if (mode === "restore") {
    for (const p of changed) {
      await db.$executeRawUnsafe(`UPDATE roles SET perms = perms_v1, perms_v1 = ARRAY[]::text[] WHERE id = $1 AND coalesce(cardinality(perms_v1), 0) > 0`, p.id);
      written += 1;
    }
  }
  if (written > 0) {
    const again = await db.$queryRawUnsafe(`SELECT id, perms, coalesce(perms_v1, '{}') AS "permsV1" FROM roles`);
    const want = new Map(changed.map((p) => [p.id, p]));
    for (const r of again) {
      const p = want.get(r.id);
      if (!p) continue;
      if (!sameList(r.perms, p.after)) throw new Error(`role ${r.id}: the saved list is not the planned list`);
      if (mode === "apply" && rewritePerms(r.perms, cat).perms.some((x, i) => x !== r.perms[i])) throw new Error(`role ${r.id}: running the rewrite again would change it`);
    }
  }

  const total = plans.length;
  const verdict = exitCode === 0 ? "PASS" : "FAIL";
  log(`\nSummary: ${total} role(s), ${changed.length} ${mode === "dry-run" ? "would change" : mode === "apply" ? "rewritten" : "restored"}, ${total - changed.length} unchanged; ` +
      `${proof.narrow.length} lost, ${proof.widen.length} gained (${allowedCount} allowed), ${proof.disagree.length} server/screens disagreements`);
  if (mode === "dry-run") log("Dry run: nothing was written. Run with --apply to write.");
  log(`${verdict}: ${exitCode === 0 ? (mode === "dry-run" ? "--apply would be allowed" : "done") : problems.join("; ")}`);
  return { exitCode, plans, proof, written, problems };
}

// ───────────── Command line ─────────────

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(["--dry-run", "--apply", "--restore", "--force", "--verbose"]);
  const bad = args.filter((a) => !known.has(a) && !/^--business=\S+$/.test(a));
  if (bad.length || (args.includes("--apply") && args.includes("--restore"))) {
    console.log(`Usage: node backend-core/scripts/rewrite-role-perms.mjs [--dry-run | --apply | --restore [--force]] [--verbose] [--business=ID[,ID]]${bad.length ? `\nUnknown: ${bad.join(" ")}` : ""}`);
    process.exit(1);
  }
  const mode = args.includes("--apply") ? "apply" : args.includes("--restore") ? "restore" : "dry-run";
  const only = args.filter((a) => a.startsWith("--business=")).flatMap((a) => a.slice(11).split(",")).filter(Boolean);

  if (!process.env.DATABASE_URL) {
    for (const f of [join(core, ".env"), join(root, ".env")]) {
      if (!existsSync(f)) continue;
      const m = readFileSync(f, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
      if (m) { process.env.DATABASE_URL = m[1]; break; }
    }
  }

  let exitCode = 1;
  const require = createRequire(join(core, "package.json"));
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  try {
    let screens;
    try {
      const mod = await import(pathToFileURL(SCREENS).href);
      screens = (perms, perm) => mod.can({ perms }, perm);
    } catch (e) {
      throw new Error(`could not load the screens' rule (shared/src/core/rbac.js): ${e.message}. Run npm install first.`);
    }
    const catalogs = loadCatalogs();
    const result = await db.$transaction((tx) => runRewrite(tx, { mode, force: args.includes("--force"), verbose: args.includes("--verbose"), only: only.length ? only : null, catalogs, screens }), { timeout: 120_000, maxWait: 20_000 });
    exitCode = result.exitCode;
  } catch (e) {
    console.log(`ERROR  ${e.message}\nFAIL: nothing was written (the transaction was rolled back).`);
    exitCode = 1;
  } finally {
    await db.$disconnect();
  }
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
