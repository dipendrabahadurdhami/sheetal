// Tests for P1-DB-3: the three access tables, the roles.perms_v1 column, the role-permission rewrite and the owners report.
// Where it fits: the suite's temporary database (test/setup-db.ts) has migration 20261112090000_access_tables applied. The rewrite
// itself is scripts/rewrite-role-perms.mjs (NOT a migration); these tests run its real code on that database.
// How it works: every database test runs inside one transaction that is rolled back at the end, so the shared test database stays
// as it was. The fixture is one business per business type with its template roles (the same lists the old app created), plus
// custom roles that exercise the hard cases (team.manage without team.view, leads.view alone, leads.view + leads.assign).
// Rules: the lists and the permission rule are read from the real files (generated catalog, platform aliases.ts, shared rbac.js);
// nothing is copied here. The owners-report query is read from check-branch-links.mjs between its marker lines.
// Run with: npm run test -w @sheetal/backend-core
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, describe, expect, inject, it } from "vitest";
// @ts-expect-error -- the script is plain JavaScript without types
import { ALLOWED_WIDENING, loadCatalogs, makeHasPerm, rewritePerms, runRewrite } from "../scripts/rewrite-role-perms.mjs";
// @ts-expect-error -- the screens' files are plain JavaScript without types
import { BUSINESS_TYPES, can, roleTemplatesFor } from "../../shared/src/core/rbac.js";
import { hasPerm } from "../../platform/src/tenancy/aliases.js";
import { LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES } from "../../platform/src/tenancy/permissions.generated.js";

type Tx = Prisma.TransactionClient;
class Rollback extends Error {}

const db = new PrismaClient({ datasources: { db: { url: inject("databaseUrl") } } });
afterAll(() => db.$disconnect());

/** Runs `fn` in a transaction and always rolls it back. An assertion that fails inside `fn` still fails the test. */
async function rolledBack<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out!: T;
  try {
    await db.$transaction(async (tx) => { out = await fn(tx); throw new Rollback(); }, { timeout: 60_000, maxWait: 20_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out;
}

const exec = (tx: Tx, sql: string, ...p: unknown[]) => tx.$executeRawUnsafe(sql, ...p);
const rows = <T>(tx: Tx, sql: string, ...p: unknown[]) => tx.$queryRawUnsafe<T[]>(sql, ...p);

// ───────────── The migration ─────────────

describe("migration 20261112090000_access_tables", () => {
  it("adds roles.perms_v1 as a list of text that defaults to empty", async () => {
    const r = await rows<{ data_type: string; is_nullable: string; column_default: string | null }>(
      db, `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'perms_v1'`);
    expect(r).toHaveLength(1);
    expect(r[0].data_type).toBe("ARRAY");
    expect(r[0].column_default).toMatch(/ARRAY\[\]/);
  });

  it("creates the three tables with their keys and indexes", async () => {
    const idx = (await rows<{ indexname: string }>(db, `SELECT indexname FROM pg_indexes WHERE tablename IN ('approval_rules','approval_requests','impersonation_sessions')`)).map((r) => r.indexname);
    expect(idx.sort()).toEqual([
      "approval_requests_pkey", "approval_requests_status_expires_at_idx", "approval_requests_tenant_id_status_created_at_idx",
      "approval_rules_pkey", "approval_rules_tenant_id_action_key",
      "impersonation_sessions_pkey", "impersonation_sessions_staff_id_ended_at_idx", "impersonation_sessions_tenant_id_ended_at_idx",
    ]);
    const unique = await rows<{ def: string }>(db, `SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'approval_rules_tenant_id_action_key'`);
    expect(unique[0].def).toMatch(/UNIQUE INDEX .*\(tenant_id, action\)/);
    const inbox = await rows<{ def: string }>(db, `SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'approval_requests_tenant_id_status_created_at_idx'`);
    expect(inbox[0].def).toMatch(/\(tenant_id, status, created_at\)/);
    const expiry = await rows<{ def: string }>(db, `SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'approval_requests_status_expires_at_idx'`);
    expect(expiry[0].def).toMatch(/\(status, expires_at\)/);
  });

  it("keeps money in paisa (bigint) and has no foreign key on branch_id, maker_id or checker_id", async () => {
    const cols = await rows<{ table_name: string; column_name: string; data_type: string }>(
      db, `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE column_name IN ('threshold_paisa','amount_paisa')`);
    expect(cols.map((c) => `${c.table_name}.${c.column_name}:${c.data_type}`).sort()).toEqual(["approval_requests.amount_paisa:bigint", "approval_rules.threshold_paisa:bigint"]);
    const fks = await rows<{ t: string; col: string; ref: string; del: string }>(
      db,
      `SELECT c.conrelid::regclass::text AS t, a.attname AS col, c.confrelid::regclass::text AS ref, c.confdeltype::text AS del
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.conrelid::regclass::text IN ('approval_rules','approval_requests','impersonation_sessions') ORDER BY 1, 2`);
    // a = no action, r = restrict, c = cascade, n = set null
    expect(fks).toEqual([
      { t: "approval_requests", col: "tenant_id", ref: "tenants", del: "c" },
      { t: "approval_rules", col: "tenant_id", ref: "tenants", del: "c" },
      { t: "impersonation_sessions", col: "staff_id", ref: "users", del: "r" },
      { t: "impersonation_sessions", col: "tenant_id", ref: "tenants", del: "n" },
    ]);
  });

  it("limits the request status to the seven known values", async () => {
    const c = await rows<{ def: string }>(db, `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'approval_requests_status_check'`);
    expect(c).toHaveLength(1);
    for (const s of ["pending", "approved", "executed", "failed", "rejected", "cancelled", "expired"]) expect(c[0].def).toContain(`'${s}'`);
    await rolledBack(async (tx) => {
      await exec(tx, `INSERT INTO plans (id, type, name, price, limits, features) VALUES ('p', 'agent', 'T', 0, '{}'::jsonb, '{}'::jsonb)`);
      await exec(tx, `INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ('t', 'T', 'agent', 'p', now())`);
      const insert = (status: string) => `INSERT INTO approval_requests (id, tenant_id, action, resource, payload, status, maker_id, expires_at) VALUES ('r_${status}', 't', 'a.b.c', 'x', '{}'::jsonb, '${status}', 'u', now())`;
      await exec(tx, insert("pending"));
      await exec(tx, "SAVEPOINT s");
      await expect(exec(tx, insert("bogus"))).rejects.toThrow(/approval_requests_status_check/);
      await exec(tx, "ROLLBACK TO SAVEPOINT s");
    });
  });

  it("inserts no rows", async () => {
    for (const t of ["approval_rules", "approval_requests", "impersonation_sessions"]) {
      expect((await rows<{ n: number }>(db, `SELECT count(*)::int AS n FROM ${t}`))[0].n, t).toBe(0);
    }
    expect((await rows<{ n: number }>(db, `SELECT count(*)::int AS n FROM roles WHERE coalesce(cardinality(perms_v1), 0) > 0`))[0].n).toBe(0);
  });

  it("keeps the impersonation trail when the business goes, and refuses to delete a staff user who has sessions", async () => {
    await rolledBack(async (tx) => {
      await exec(tx, `INSERT INTO plans (id, type, name, price, limits, features) VALUES ('p', 'agent', 'T', 0, '{}'::jsonb, '{}'::jsonb)`);
      await exec(tx, `INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ('t', 'T', 'agent', 'p', now())`);
      await exec(tx, `INSERT INTO users (id, email, user_name, updated_at) VALUES ('s', 's@example.test', 's', now())`);
      await exec(tx, `INSERT INTO impersonation_sessions (id, staff_id, tenant_id, reason, expires_at) VALUES ('i', 's', 't', 'support ticket', now() + interval '1 hour')`);
      const r = (await rows<{ read_only: boolean; request_count: number }>(tx, `SELECT read_only, request_count FROM impersonation_sessions WHERE id = 'i'`))[0];
      expect(r).toEqual({ read_only: true, request_count: 0 });          // safe defaults
      await exec(tx, "SAVEPOINT s");
      await expect(exec(tx, `DELETE FROM users WHERE id = 's'`)).rejects.toThrow();
      await exec(tx, "ROLLBACK TO SAVEPOINT s");
      await exec(tx, `DELETE FROM tenants WHERE id = 't'`);
      const after = await rows<{ tenant_id: string | null }>(tx, `SELECT tenant_id FROM impersonation_sessions WHERE id = 'i'`);
      expect(after).toEqual([{ tenant_id: null }]);                       // the row survives, the business link is cleared
    });
  });
});

// ───────────── The permission rule inside the script ─────────────

const cat = loadCatalogs();
const ALL_NAMES = [...new Set<string>([...cat.oldNames, ...cat.businessNames])];

describe("the rewrite script reads and applies the same rules as the app", () => {
  it("reads the alias maps from the generated file exactly", () => {
    expect(cat.aliases).toEqual(LEGACY_ALIASES);
    expect(cat.platformAliases).toEqual(LEGACY_PLATFORM_ALIASES);
  });

  // Role shapes: every template of every business type, every single old name, every single new name, and seeded random mixes.
  const shapes: string[][] = [];
  for (const t of Object.keys(BUSINESS_TYPES)) for (const r of roleTemplatesFor(t)) shapes.push(r.perms);
  for (const n of cat.oldNames) shapes.push([n]);
  for (const n of cat.businessNames) shapes.push([n], [`${n}:own`], [`${n}:branch`]);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i += 1) shapes.push(ALL_NAMES.filter(() => rnd() < 0.15));

  it("answers like the server rule (platform aliases.ts) and the screens' rule (shared rbac.js)", () => {
    const mine = makeHasPerm([cat.aliases, cat.platformAliases]);
    for (const perms of shapes) {
      for (const name of ALL_NAMES) {
        const server = hasPerm(perms, name);
        expect(mine(perms, name), `${name} for ${perms.join(",")}`).toBe(server);
        expect(can({ perms }, name), `screens ${name} for ${perms.join(",")}`).toBe(server);
      }
    }
  });

  it("rewrites a list so that a second rewrite changes nothing", () => {
    for (const perms of shapes) {
      const once = rewritePerms(perms, cat).perms;
      expect(rewritePerms(once, cat).perms, perms.join(",")).toEqual(once);
    }
  });

  it("gives every template role a rewritten list that answers the same for every name (no gain, no loss)", () => {
    const hp = makeHasPerm([cat.aliases, cat.platformAliases]);
    for (const t of Object.keys(BUSINESS_TYPES)) {
      for (const r of roleTemplatesFor(t)) {
        const after = rewritePerms(r.perms, cat).perms;
        for (const name of ALL_NAMES) expect(hp(after, name), `${t}/${r.key}/${name}`).toBe(hp(r.perms, name));
      }
    }
  });

  it("applies the Lead's leads rule: view+assign -> branch, view alone -> own", () => {
    expect(rewritePerms(["leads.view", "leads.assign"], cat).perms).toEqual(expect.arrayContaining(["crm.lead.read:branch", "crm.lead.assign:branch"]));
    expect(rewritePerms(["leads.view"], cat).perms).toEqual(["crm.lead.read:own"]);
    expect(rewritePerms(["leads.view", "customers.view"], cat).perms).toContain("crm.lead.read:own");
  });

  it("keeps '*', names it does not know, and names that are already new", () => {
    expect(rewritePerms(["*"], cat).perms).toEqual(["*"]);
    const r = rewritePerms(["made.up.name", "crm.lead.read:own"], cat);
    expect(r.perms).toEqual(["made.up.name", "crm.lead.read:own"]);
    expect(r.unknown).toEqual(["made.up.name"]);
  });
});

// ───────────── The rewrite on a database ─────────────

const CUSTOM: Record<string, string[]> = {
  teamManageOnly: ["team.manage", "customers.view"],          // manage without view: gains team.view (allowed, explained in CHANGES)
  leadsViewOnly: ["leads.view"],                              // becomes crm.lead.read:own
  leadsAssign: ["leads.view", "leads.assign", "customers.view"],
  mixedNewOld: ["crm.lead.read:own", "customers.view"],       // already partly moved
  unknownName: ["customers.view", "legacy.thing"],
};

/** One business per business type with its template roles, plus the custom roles in the first business. */
async function seedBusinesses(tx: Tx) {
  await exec(tx, `INSERT INTO plans (id, type, name, price, limits, features) VALUES ('rp', 'agent', 'T', 0, '{}'::jsonb, '{}'::jsonb)`);
  const types = Object.keys(BUSINESS_TYPES);
  for (const t of types) {
    await exec(tx, `INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ($1, $2, $3, 'rp', now())`, `rt_${t}`, `Business ${t}`, t);
    for (const r of roleTemplatesFor(t)) {
      await exec(tx, `INSERT INTO roles (id, tenant_id, key, system, perms) VALUES ($1, $2, $3, true, $4::text[])`, `rr_${t}_${r.key}`, `rt_${t}`, r.key, r.perms);
    }
  }
  for (const [key, perms] of Object.entries(CUSTOM)) {
    await exec(tx, `INSERT INTO roles (id, tenant_id, key, name, system, perms) VALUES ($1, $2, $3, $3, false, $4::text[])`, `rr_custom_${key}`, `rt_${types[0]}`, key, perms);
  }
}

const silent = () => {};
const allRoles = (tx: Tx) => rows<{ id: string; perms: string[]; permsV1: string[] }>(tx, `SELECT id, perms, coalesce(perms_v1, '{}') AS "permsV1" FROM roles ORDER BY id`);
const screens = (perms: string[], perm: string) => can({ perms }, perm);
const run = (tx: Tx, mode: string, extra: Record<string, unknown> = {}) => runRewrite(tx, { mode, log: silent, catalogs: cat, screens, ...extra });

describe("scripts/rewrite-role-perms.mjs on a database", () => {
  it("a dry run writes nothing and passes on the fixture", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      const before = await allRoles(tx);
      const r = await run(tx, "dry-run");
      expect(r.exitCode).toBe(0);
      expect(r.written).toBe(0);
      expect(await allRoles(tx)).toEqual(before);
    });
  });

  it("--apply: only the planted gains appear, the backup holds the old lists, and the proof agrees for server and screens", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      const before = new Map((await allRoles(tx)).map((r) => [r.id, r.perms]));
      const r = await run(tx, "apply");
      expect(r.exitCode).toBe(0);
      expect(r.proof.narrow).toEqual([]);
      expect(r.proof.disagree).toEqual([]);
      // every gain is on the allow-list and belongs to a role that holds the matching manage permission
      for (const g of r.proof.widen) expect(ALLOWED_WIDENING).toContain(g.name);
      const gained = r.proof.widen.map((g: { role: { key: string }; name: string }) => `${g.role.key}:${g.name}`);
      expect(gained).toContain("teamManageOnly:team.view");
      const after = await allRoles(tx);
      for (const row of after) {
        if (JSON.stringify(row.perms) === JSON.stringify(before.get(row.id))) continue;   // "*" roles are untouched
        expect(row.permsV1, row.id).toEqual(before.get(row.id));                          // old list kept exactly
      }
      const get = (k: string) => after.find((x) => x.id === `rr_custom_${k}`)!;
      expect(get("leadsViewOnly").perms).toEqual(["crm.lead.read:own"]);
      expect(get("leadsAssign").perms).toEqual(expect.arrayContaining(["crm.lead.read:branch", "crm.lead.assign:branch"]));
      expect(get("unknownName").perms).toContain("legacy.thing");
      // owners keep "*" and no backup is made for them
      const owner = after.find((x) => x.id === "rr_hotel_owner");
      if (owner && owner.perms.includes("*")) expect(owner.permsV1).toEqual([]);
      // no new-name entry without a valid scope suffix when the catalog says the name has scopes
      for (const row of after) for (const e of row.perms) {
        if (e === "*") continue;
        const [base, scope] = e.split(":");
        const info = cat.byId.get(base);
        if (info?.scopes?.length && scope !== undefined) expect(info.scopes, `${row.id} ${e}`).toContain(scope);
      }
    });
  });

  it("a second --apply changes nothing and keeps the first backup", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      await run(tx, "apply");
      const once = await allRoles(tx);
      const again = await run(tx, "apply");
      expect(again.exitCode).toBe(0);
      expect(again.written).toBe(0);
      expect(await allRoles(tx)).toEqual(once);
    });
  });

  it("--restore puts back the exact old lists and empties the backup, and a second --restore changes nothing (QA, P1-DB-3 fix 2)", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      const before = await allRoles(tx);
      await run(tx, "apply");
      const r = await run(tx, "restore");
      expect(r.exitCode).toBe(0);
      expect((await allRoles(tx)).map((x) => [x.id, x.perms])).toEqual(before.map((x) => [x.id, x.perms]));
      expect((await allRoles(tx)).filter((x) => x.permsV1.length > 0)).toEqual([]);   // perms_v1 always means "the list before the latest rewrite"
      expect((await run(tx, "restore")).written).toBe(0);
    });
  });

  it("--restore refuses to overwrite a role edited after the rewrite, unless --force", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      await run(tx, "apply");
      await exec(tx, `UPDATE roles SET perms = array_append(perms, 'reports.report.read:all') WHERE id = 'rr_custom_leadsViewOnly'`);
      const edited = (await allRoles(tx)).find((x) => x.id === "rr_custom_leadsViewOnly")!.perms;
      const refused = await run(tx, "restore");
      expect(refused.exitCode).toBe(1);
      expect((await allRoles(tx)).find((x) => x.id === "rr_custom_leadsViewOnly")!.perms).toEqual(edited);
      const forced = await run(tx, "restore", { force: true });
      expect(forced.exitCode).toBe(0);
      expect((await allRoles(tx)).find((x) => x.id === "rr_custom_leadsViewOnly")!.perms).toEqual(CUSTOM.leadsViewOnly);
    });
  });

  it("--business=ID acts on that business only", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      const r = await run(tx, "apply", { only: ["rt_hotel"] });
      expect(r.exitCode).toBe(0);
      const after = await allRoles(tx);
      expect(after.filter((x) => x.id.startsWith("rr_host_")).every((x) => x.permsV1.length === 0)).toBe(true);
      expect(after.filter((x) => x.id.startsWith("rr_custom_")).every((x) => x.permsV1.length > 0)).toBe(true);
    });
  });

  it("refuses --apply (exit 1, nothing written) when a rewrite would LOSE a permission", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      const before = await allRoles(tx);
      // a broken catalog: one old name loses one of its new names, so the rewritten list cannot answer the old question
      const broken = { ...cat, aliases: { ...cat.aliases, "invoices.create": cat.aliases["invoices.create"].slice(0, 1) } };
      const r = await runRewrite(tx, { mode: "apply", log: silent, catalogs: broken, screens });
      expect(r.exitCode).toBe(1);
      expect(r.written).toBe(0);
      expect(await allRoles(tx)).toEqual(before);
    });
  });

  it("refuses --apply when a role would GAIN a name that is not on the allow-list", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      const before = await allRoles(tx);
      expect(ALLOWED_WIDENING.slice().sort()).toEqual(["expenses.view", "invoices.view", "people.view", "rentals.view", "team.view"]);
      const r = await runRewrite(tx, { mode: "apply", log: silent, catalogs: cat, screens, allowed: [] });   // pretend nothing is allowed
      expect(r.proof.widen.map((g: { name: string }) => g.name)).toContain("team.view");
      expect(r.exitCode).toBe(1);
      expect(r.written).toBe(0);
      expect(await allRoles(tx)).toEqual(before);
    });
  });

  it("refuses --apply when the server rule and the screens' rule disagree", async () => {
    await rolledBack(async (tx) => {
      await seedBusinesses(tx);
      const before = await allRoles(tx);
      const wrongScreens = (perms: string[], perm: string) => (perm === "leads.view" ? !can({ perms }, perm) : can({ perms }, perm));
      const r = await runRewrite(tx, { mode: "apply", log: silent, catalogs: cat, screens: wrongScreens });
      expect(r.exitCode).toBe(1);
      expect(r.proof.disagree.length).toBeGreaterThan(0);
      expect(await allRoles(tx)).toEqual(before);
    });
  });
});

// ───────────── The owners report (check-branch-links.mjs, section d) ─────────────

const CHECK = readFileSync(fileURLToPath(new URL("../scripts/check-branch-links.mjs", import.meta.url)), "utf8");
const OWNERS_SQL = /^\/\/ OWNERS SQL START\r?\nconst OWNERS_SQL = `([\s\S]*?)`;\r?\n\/\/ OWNERS SQL END/m.exec(CHECK)?.[1] ?? "";

describe("check-branch-links.mjs section (d): owners that still carry a branch list", () => {
  it("finds an owner with a name list, an owner with link rows and an owner with the limited flag, and skips clean owners and non-owners", async () => {
    expect(OWNERS_SQL).toContain("'*' = ANY (r.perms)");
    await rolledBack(async (tx) => {
      await exec(tx, `INSERT INTO plans (id, type, name, price, limits, features) VALUES ('p', 'agent', 'T', 0, '{}'::jsonb, '{}'::jsonb)`);
      await exec(tx, `INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ('t', 'Owners Co', 'agent', 'p', now())`);
      await exec(tx, `INSERT INTO branches (id, tenant_id, name) VALUES ('b1', 't', 'Thamel')`);
      await exec(tx, `INSERT INTO roles (id, tenant_id, key, perms) VALUES ('ro', 't', 'owner', '{*}'), ('rs', 't', 'staff', '{customers.view}')`);
      const member = async (k: string, role: string, scopes: string) => {
        await exec(tx, `INSERT INTO users (id, email, user_name, updated_at) VALUES ($1, $2, $1, now())`, `u_${k}`, `${k}@example.test`);
        await exec(tx, `INSERT INTO memberships (id, user_id, tenant_id, role_id, scopes) VALUES ($1, $2, 't', $3, $4::jsonb)`, `m_${k}`, `u_${k}`, role, scopes);
      };
      await member("clean", "ro", '"all"');
      await member("list", "ro", '["Thamel"]');
      await member("link", "ro", '"all"');
      await exec(tx, `INSERT INTO membership_branches (membership_id, branch_id) VALUES ('m_link', 'b1')`);
      await member("flag", "ro", '"all"');
      await exec(tx, `UPDATE memberships SET all_branches = false WHERE id = 'm_flag'`);
      await member("staff", "rs", '["Thamel"]');                   // a limited non-owner is normal, not reported
      const found = (await rows<{ id: string }>(tx, OWNERS_SQL)).map((r) => r.id).sort();
      expect(found).toEqual(["m_flag", "m_link", "m_list"]);
    });
  });
});
