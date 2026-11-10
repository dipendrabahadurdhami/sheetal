// Test helper: builds a real BusinessContext for repository, service and controller tests.
// Where it fits: platform tests (and later the app tests). The real builder from a login arrives in P1-BE-3; this one takes
// everything from its arguments, so a test says exactly who is acting, in which business, at which branches.
// How it works: `transaction()` is real (db.$transaction), so rollback behaviour can be tested. Permissions are a plain
// map of permission -> scope ("*" grants everything with scope "all"). The branch scope follows the rules in KERNEL.md section 5.
// Rules: tests only. Nothing in production code imports this file.

import type { FastifyBaseLogger } from "fastify";
import { forbidden, badRequest } from "../errors.js";
import type { Db } from "../../db/client.js";
import type { BranchScope, BusinessContext, DataScope, Entitlements, PermissionId, PermissionSet, Tx } from "../context.js";

export interface TestContextOptions {
  db: Db;
  businessId: string;
  /** Every branch of the business (open ones). */
  branches: readonly { id: string; name?: string }[];
  /** The branches this member may use. Default "all". */
  allowed?: "all" | readonly string[];
  /** The branch the top bar picked. Default null. */
  picked?: string | null;
  userId?: string;
  /** permission -> scope, or "*" for everything. Default "*". */
  grants?: Record<PermissionId, DataScope> | "*";
  apps?: readonly string[] | "*";
  limits?: Record<string, number | null>;
  isOwner?: boolean;
  now?: Date;
}

export function makeTestPermissions(grants: Record<PermissionId, DataScope> | "*"): PermissionSet {
  const scopeOf = (p: PermissionId): DataScope | null => (grants === "*" ? "all" : grants[p] ?? null);
  return {
    can: (p) => scopeOf(p) !== null,
    scopeOf,
    require(p, message) {
      const s = scopeOf(p);
      if (!s) throw forbidden(message ?? "You don't have permission to do that.");
      return s;
    },
    canAny: (ps) => ps.some((p) => scopeOf(p) !== null),
  };
}

export function makeTestBranchScope(o: { all: readonly { id: string; name?: string }[]; allowed: "all" | readonly string[]; picked: string | null }): BranchScope {
  const mine = o.all.filter((b) => o.allowed === "all" || o.allowed.includes(b.id)).map((b) => ({ id: b.id, name: b.name ?? b.id, status: "open" as const }));
  const mineIds = mine.map((b) => b.id);
  return {
    allowed: o.allowed, mine, picked: o.picked,
    idsFor(scope) {
      if (scope === "all") return o.allowed === "all" ? null : mineIds;
      return o.picked && mineIds.includes(o.picked) ? [o.picked] : mineIds;   // "branch" and "own": the picked branch, else all of mine
    },
    branchForNew(asked) {
      const id = asked ?? o.picked ?? (mineIds.length === 1 ? mineIds[0]! : null);
      if (!id) throw badRequest("Pick a branch first.");
      if (!mineIds.includes(id)) throw forbidden("You don't work at that branch.");
      return id;
    },
    canSee: (id) => !id || mineIds.includes(id),   // a branch outside this business is never in mineIds
  };
}

export function makeTestContext(o: TestContextOptions): BusinessContext {
  const userId = o.userId ?? "test-user";
  const apps = o.apps ?? "*";
  const entitlements: Entitlements = {
    hasApp: (a) => apps === "*" || apps.includes(a),
    edition: () => "default",
    limit: (_a, k) => o.limits?.[k] ?? null,
    feature: () => true,
    seats: () => ({ used: 1, limit: null }),
    ai: () => "locked",
  };
  const base = {
    requestId: "test-request", ip: "127.0.0.1", now: o.now ?? new Date(), db: o.db,
    log: { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; }, level: "silent", silent() {} } as unknown as FastifyBaseLogger,
    actor: { kind: "user" as const, userId, name: "Test User" },
    business: { id: o.businessId, name: "Test business", type: "test", status: "active", planId: "test-plan" },
    member: { userId, membershipId: "test-membership", roleId: "test-role", roleKey: "owner", isOwner: o.isOwner ?? true },
    branches: makeTestBranchScope({ all: o.branches, allowed: o.allowed ?? "all", picked: o.picked ?? null }),
    permissions: makeTestPermissions(o.grants ?? "*"),
    entitlements, impersonation: null,
  };
  const make = (tx: Tx | null): BusinessContext => ({
    ...base, tx,
    transaction: (async (fn: (c: BusinessContext) => Promise<unknown>) =>
      tx ? fn(make(tx)) : o.db.$transaction(async (t) => fn(make(t)))) as BusinessContext["transaction"],
  });
  return make(null);
}
