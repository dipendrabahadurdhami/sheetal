// Tests for the branch-ID links backfill (migration 20261111090000_branch_links, ACCESS.md section 3.4 step 2).
// Where it fits: the suite's temporary database (test/setup-db.ts) has the migration applied. These tests build a small
// business as it looked BEFORE the migration (people and invitations with branch NAMES in "scopes"), run the backfill
// statement read from the migration file, and check every edge case of the table in ACCESS.md 3.4.
// How it works: each test runs inside one database transaction that is rolled back at the end, so the shared test database
// is left exactly as it was. All statements are plain SQL on the real tables.
// Rules: the backfill is read from the migration file, never copied here, so the test checks what will really run.
import type {} from "@sheetal/platform/test/setup-db";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, describe, expect, inject, it } from "vitest";

type Tx = Prisma.TransactionClient;
class Rollback extends Error {}

const db = new PrismaClient({ datasources: { db: { url: inject("databaseUrl") } } });
afterAll(() => db.$disconnect());

// ───────────── The backfill, read from the migration file ─────────────

const FILE = readFileSync(fileURLToPath(new URL("../prisma/migrations/20261111090000_branch_links/migration.sql", import.meta.url)), "utf8");
const BACKFILL = /^-- BACKFILL START\r?\n([\s\S]*?)^-- BACKFILL END/m.exec(FILE)?.[1]?.trim() ?? "";
const runBackfill = (tx: Tx) => tx.$executeRawUnsafe(BACKFILL);

// ───────────── The business as it was before the migration ─────────────

const MEMBERS = {
  mixedCase: { scopes: ["head OFFICE", "Thamel"], role: "staff" },
  all: { scopes: "all", role: "staff" },
  none: { scopes: null, role: "staff" },
  stale: { scopes: ["Thamel", "Gone Branch"], role: "staff" },
  empty: { scopes: [], role: "staff" },
  allStale: { scopes: ["Gone Branch"], role: "staff" },
  owner: { scopes: ["Thamel"], role: "owner" },
  closed: { scopes: ["Old Closed"], role: "staff" },
  paused: { scopes: ["Thamel"], role: "staff", status: "paused" },
  repeated: { scopes: ["Thamel", "thamel", "THAMEL"], role: "staff" },
  odd: { scopes: [1, null, "Thamel"], role: "staff" },
  otherBusiness: { scopes: ["Head office", "Thamel"], role: "staff2", tenant: "t2" },
  exactWins: { scopes: ["Lakeside"], role: "staff3", tenant: "t3" },
  ambiguous: { scopes: ["LAKESIDE"], role: "staff3", tenant: "t3" },
} as const;
type MemberKey = keyof typeof MEMBERS;

const INVITES = {
  pending: { scopes: ["Thamel", "gone"], status: "pending", role: "staff" },
  accepted: { scopes: ["Thamel"], status: "accepted", role: "staff" },
  revoked: { scopes: ["head office"], status: "revoked", role: "staff" },
  pendingAll: { scopes: "all", status: "pending", role: "staff" },
  pendingOwner: { scopes: ["Thamel"], status: "pending", role: "owner" },
  pendingEmpty: { scopes: [], status: "pending", role: "staff" },
} as const;
type InviteKey = keyof typeof INVITES;

const id = (s: string) => `bl_${s}`;
const exec = (tx: Tx, sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);
const rows = <T>(tx: Tx, sql: string, ...params: unknown[]) => tx.$queryRawUnsafe<T[]>(sql, ...params);

async function seed(tx: Tx) {
  await exec(tx, `INSERT INTO plans (id, type, name, price, limits, features) VALUES ($1, 'agent', 'Test', 0, '{}'::jsonb, '{}'::jsonb)`, id("plan"));
  for (const t of ["t1", "t2", "t3"]) {
    await exec(tx, `INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ($1, $2, 'agent', $3, now())`, id(t), `Business ${t}`, id("plan"));
  }
  const branches: [string, string, string, string][] = [
    ["head", "t1", "Head office", "open"], ["thamel", "t1", "Thamel", "open"], ["closed", "t1", "Old Closed", "closed"],
    ["t2thamel", "t2", "Thamel", "open"],
    ["lake", "t3", "Lakeside", "open"], ["lakelow", "t3", "lakeside", "open"],
  ];
  for (const [key, tenant, name, status] of branches) {
    await exec(tx, `INSERT INTO branches (id, tenant_id, name, status) VALUES ($1, $2, $3, $4)`, id(key), id(tenant), name, status);
  }
  const roles: [string, string, string[]][] = [
    ["owner", "t1", ["*"]], ["staff", "t1", ["expenses.expense.read"]], ["staff2", "t2", ["expenses.expense.read"]], ["staff3", "t3", ["expenses.expense.read"]],
  ];
  for (const [key, tenant, perms] of roles) {
    await exec(tx, `INSERT INTO roles (id, tenant_id, key, perms) VALUES ($1, $2, $3, $4::text[])`, id(`role_${key}`), id(tenant), key, perms);
  }
  for (const [key, m] of Object.entries(MEMBERS)) {
    const tenant = "tenant" in m ? m.tenant : "t1";
    await exec(tx, `INSERT INTO users (id, email, user_name, updated_at) VALUES ($1, $2, $3, now())`, id(`u_${key}`), `${id(key)}@example.test`.toLowerCase(), key);
    await exec(
      tx,
      `INSERT INTO memberships (id, user_id, tenant_id, role_id, scopes, status) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      id(`m_${key}`), id(`u_${key}`), id(tenant), id(`role_${m.role}`), JSON.stringify(m.scopes), "status" in m ? m.status : "active",
    );
  }
  for (const [key, inv] of Object.entries(INVITES)) {
    await exec(
      tx,
      `INSERT INTO invites (id, tenant_id, email, role_id, scopes, token_hash, status, expires_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, now() + interval '7 days')`,
      id(`i_${key}`), id("t1"), `${id(key)}@example.test`.toLowerCase(), id(`role_${inv.role}`), JSON.stringify(inv.scopes), id(`hash_${key}`), inv.status,
    );
  }
}

// ───────────── What the database says afterwards ─────────────

const memberId = (k: MemberKey) => id(`m_${k}`);
const inviteId = (k: InviteKey) => id(`i_${k}`);
const memberAll = async (tx: Tx, k: MemberKey) => (await rows<{ a: boolean }>(tx, `SELECT all_branches AS a FROM memberships WHERE id = $1`, memberId(k)))[0]?.a;
const inviteAll = async (tx: Tx, k: InviteKey) => (await rows<{ a: boolean }>(tx, `SELECT all_branches AS a FROM invites WHERE id = $1`, inviteId(k)))[0]?.a;
const memberBranches = async (tx: Tx, k: MemberKey) =>
  (await rows<{ n: string }>(tx, `SELECT b.id AS n FROM membership_branches mb JOIN branches b ON b.id = mb.branch_id WHERE mb.membership_id = $1 ORDER BY b.id`, memberId(k))).map((r) => r.n);
const inviteBranches = async (tx: Tx, k: InviteKey) =>
  (await rows<{ n: string }>(tx, `SELECT b.id AS n FROM invite_branches ib JOIN branches b ON b.id = ib.branch_id WHERE ib.invite_id = $1 ORDER BY b.id`, inviteId(k))).map((r) => r.n);

/** Everything the backfill owns for the fixture, to compare a first and a second run. */
async function snapshot(tx: Tx) {
  return {
    members: await rows(tx, `SELECT id, all_branches, scopes FROM memberships WHERE id LIKE 'bl\\_%' ORDER BY id`),
    invites: await rows(tx, `SELECT id, all_branches, scopes FROM invites WHERE id LIKE 'bl\\_%' ORDER BY id`),
    memberLinks: await rows(tx, `SELECT membership_id, branch_id FROM membership_branches WHERE membership_id LIKE 'bl\\_%' ORDER BY 1, 2`),
    inviteLinks: await rows(tx, `SELECT invite_id, branch_id FROM invite_branches WHERE invite_id LIKE 'bl\\_%' ORDER BY 1, 2`),
  };
}

/** Builds the fixture, runs the backfill once, lets the test look, then rolls everything back. */
async function inFixture(check: (tx: Tx) => Promise<void>) {
  try {
    await db.$transaction(async (tx) => {
      await seed(tx);
      await runBackfill(tx);
      await check(tx);
      throw new Rollback();
    }, { timeout: 60_000, maxWait: 20_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

// ───────────── Tests ─────────────

describe("branch links migration file", () => {
  it("has a backfill that is one DO statement, and drops nothing", () => {
    expect(BACKFILL.startsWith("DO $backfill$")).toBe(true);
    expect(BACKFILL.trimEnd().endsWith("$backfill$;")).toBe(true);
    expect(FILE).not.toMatch(/\bDROP\b/i);
    expect(FILE).not.toMatch(/ALTER TABLE "(memberships|invites)"\s+(DROP|RENAME|ALTER COLUMN)/i);
  });

  it("starts every person at 'all branches' until the backfill decides (the column default)", async () => {
    try {
      await db.$transaction(async (tx) => {
        await seed(tx);
        expect(await memberAll(tx, "mixedCase")).toBe(true);
        expect(await inviteAll(tx, "pending")).toBe(true);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  });
});

describe("backfill of members", () => {
  it("turns a list of names into branch ids, ignoring upper/lower case", () =>
    inFixture(async (tx) => {
      expect(await memberAll(tx, "mixedCase")).toBe(false);
      expect(await memberBranches(tx, "mixedCase")).toEqual([id("head"), id("thamel")].sort());
    }));

  it("keeps 'all', null and missing as all branches, with no rows", () =>
    inFixture(async (tx) => {
      for (const k of ["all", "none"] as const) {
        expect(await memberAll(tx, k)).toBe(true);
        expect(await memberBranches(tx, k)).toEqual([]);
      }
    }));

  it("drops a stale name and keeps the rest", () =>
    inFixture(async (tx) => {
      expect(await memberAll(tx, "stale")).toBe(false);
      expect(await memberBranches(tx, "stale")).toEqual([id("thamel")]);
    }));

  it("never widens: an empty list, or only stale names, stays limited with no branch", () =>
    inFixture(async (tx) => {
      for (const k of ["empty", "allStale"] as const) {
        expect(await memberAll(tx, k)).toBe(false);
        expect(await memberBranches(tx, k)).toEqual([]);
      }
    }));

  it("makes an owner all branches whatever the list says, with no rows", () =>
    inFixture(async (tx) => {
      expect(await memberAll(tx, "owner")).toBe(true);
      expect(await memberBranches(tx, "owner")).toEqual([]);
    }));

  it("keeps a closed branch", () =>
    inFixture(async (tx) => {
      expect(await memberAll(tx, "closed")).toBe(false);
      expect(await memberBranches(tx, "closed")).toEqual([id("closed")]);
    }));

  it("links a paused member too, and writes one row for a name repeated in different cases", () =>
    inFixture(async (tx) => {
      expect(await memberBranches(tx, "paused")).toEqual([id("thamel")]);
      expect(await memberBranches(tx, "repeated")).toEqual([id("thamel")]);
    }));

  it("ignores list entries that are not text", () =>
    inFixture(async (tx) => {
      expect(await memberAll(tx, "odd")).toBe(false);
      expect(await memberBranches(tx, "odd")).toEqual([id("thamel")]);
    }));

  it("only matches branches of the member's own business", () =>
    inFixture(async (tx) => {
      // The other business has "Thamel" but no "Head office": only Thamel links, and it is that business's Thamel.
      expect(await memberBranches(tx, "otherBusiness")).toEqual([id("t2thamel")]);
    }));

  it("prefers an exact name, and treats a name that fits two branches only by case as stale", () =>
    inFixture(async (tx) => {
      expect(await memberBranches(tx, "exactWins")).toEqual([id("lake")]);
      expect(await memberAll(tx, "ambiguous")).toBe(false);
      expect(await memberBranches(tx, "ambiguous")).toEqual([]);
    }));

  it("leaves 'scopes' exactly as it was", () =>
    inFixture(async (tx) => {
      for (const [k, m] of Object.entries(MEMBERS)) {
        const [row] = await rows<{ scopes: unknown }>(tx, `SELECT scopes FROM memberships WHERE id = $1`, memberId(k as MemberKey));
        expect(row?.scopes).toEqual(m.scopes);
      }
    }));
});

describe("backfill of invitations", () => {
  it("sets the flag on every invite, and fills rows only for pending ones", () =>
    inFixture(async (tx) => {
      expect(await inviteAll(tx, "pending")).toBe(false);
      expect(await inviteBranches(tx, "pending")).toEqual([id("thamel")]);
      // accepted and revoked invites: limited flag, but no rows
      for (const k of ["accepted", "revoked"] as const) {
        expect(await inviteAll(tx, k)).toBe(false);
        expect(await inviteBranches(tx, k)).toEqual([]);
      }
    }));

  it("keeps 'all' as all branches, makes an owner invite all branches, and never widens an empty list", () =>
    inFixture(async (tx) => {
      expect(await inviteAll(tx, "pendingAll")).toBe(true);
      expect(await inviteAll(tx, "pendingOwner")).toBe(true);
      expect(await inviteBranches(tx, "pendingOwner")).toEqual([]);
      expect(await inviteAll(tx, "pendingEmpty")).toBe(false);
      expect(await inviteBranches(tx, "pendingEmpty")).toEqual([]);
    }));
});

describe("running the backfill twice", () => {
  it("changes nothing the second time", async () => {
    try {
      await db.$transaction(async (tx) => {
        await seed(tx);
        await runBackfill(tx);
        const first = await snapshot(tx);
        await runBackfill(tx);
        expect(await snapshot(tx)).toEqual(first);
        // and it really did something the first time
        expect(first.memberLinks.length).toBeGreaterThan(5);
        expect(first.inviteLinks.length).toBe(1);
        throw new Rollback();
      }, { timeout: 60_000, maxWait: 20_000 });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  });
});

describe("foreign keys", () => {
  it("deleting a branch removes its link rows (members and invites) and nothing else", () =>
    inFixture(async (tx) => {
      await exec(tx, `DELETE FROM branches WHERE id = $1`, id("thamel"));
      const [m] = await rows<{ n: number }>(tx, `SELECT count(*)::int AS n FROM membership_branches WHERE branch_id = $1`, id("thamel"));
      const [i] = await rows<{ n: number }>(tx, `SELECT count(*)::int AS n FROM invite_branches WHERE branch_id = $1`, id("thamel"));
      expect(m?.n).toBe(0);
      expect(i?.n).toBe(0);
      // the people are still there, and their other links too
      expect(await memberBranches(tx, "mixedCase")).toEqual([id("head")]);
      expect(await memberAll(tx, "stale")).toBe(false);
      expect(await memberBranches(tx, "stale")).toEqual([]);
      expect(await memberBranches(tx, "closed")).toEqual([id("closed")]);
    }));

  it("deleting a member or an invite removes its link rows", () =>
    inFixture(async (tx) => {
      await exec(tx, `DELETE FROM memberships WHERE id = $1`, memberId("mixedCase"));
      await exec(tx, `DELETE FROM invites WHERE id = $1`, inviteId("pending"));
      const [m] = await rows<{ n: number }>(tx, `SELECT count(*)::int AS n FROM membership_branches WHERE membership_id = $1`, memberId("mixedCase"));
      const [i] = await rows<{ n: number }>(tx, `SELECT count(*)::int AS n FROM invite_branches WHERE invite_id = $1`, inviteId("pending"));
      expect(m?.n).toBe(0);
      expect(i?.n).toBe(0);
    }));

  it("refuses a link to a branch that does not exist", () =>
    inFixture(async (tx) => {
      // A failed statement aborts a transaction, so this one runs in its own savepoint.
      await exec(tx, `SAVEPOINT bad`);
      await expect(exec(tx, `INSERT INTO membership_branches (membership_id, branch_id) VALUES ($1, 'no-such-branch')`, memberId("all"))).rejects.toThrow();
      await exec(tx, `ROLLBACK TO SAVEPOINT bad`);
    }));
});
