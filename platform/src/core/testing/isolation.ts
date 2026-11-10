// Test helper: proves a repository keeps businesses, branches and deleted rows apart.
// Where it fits: every app's repository test calls `testRepositoryIsolation(...)` once (P1-BE-5 onwards); it is the CI guard for tenant isolation.
// How it works: builds two businesses (A with branches A1 and A2, B with B1) and rows in each, straight through Prisma, then asks the
// repository questions that must be refused or hidden. `runRepositoryIsolation` returns a list of problems (empty = good), so a
// test can also hand it a deliberately broken repository and see that the problems are found.
// Rules: tests only. It adds rows with unique ids and does not clean up (the test database is thrown away after the run).

import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Db } from "../../db/client.js";
import type { BaseRepository, BusinessEntity } from "../repository.js";
import { makeTestContext } from "./context.js";

export interface IsolationOptions {
  db: Db;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  repo: BaseRepository<any, any, any>;
  /** The Prisma delegate name, same as the repository's `model`. */
  model: string;
  /** Full data for one row, for a direct Prisma insert (must satisfy the table's required columns). n is unique per row. */
  row(a: { tenantId: string; branchId: string; userId: string; n: number }): Record<string, unknown>;
  /** A valid create input for the repository (without business, creator or version). */
  createData(a: { branchId: string }): Record<string, unknown>;
  /** A valid update input that changes `changedField`. */
  update: { data: Record<string, unknown>; changedField: string };
  /** Optional: a compare-and-set that would apply to an own-business row if it were visible. */
  transition?: { from: Record<string, unknown>; to: Record<string, unknown> };
}

type AnyRow = BusinessEntity & Record<string, unknown>;

export async function runRepositoryIsolation(o: IsolationOptions): Promise<string[]> {
  const problems: string[] = [];
  const bad = (m: string) => { problems.push(m); };
  const tag = randomUUID().slice(0, 8);
  const delegate = (o.db as unknown as Record<string, { create(a: unknown): Promise<AnyRow>; findUnique(a: unknown): Promise<AnyRow | null> }>)[o.model]!;

  // ── fixture: one plan, two businesses, three branches ──
  const planId = `iso-plan-${tag}`;
  await o.db.plan.create({ data: { id: planId, type: "test", name: "Isolation plan", price: 0, limits: {}, features: {} } });
  const mkTenant = (n: string) => o.db.tenant.create({ data: { name: `Iso ${n} ${tag}`, type: "test", planId } });
  const A = await mkTenant("A"); const B = await mkTenant("B");
  const mkBranch = (t: string, n: string) => o.db.branch.create({ data: { tenantId: t, name: `${n} ${tag}` } });
  const A1 = await mkBranch(A.id, "A1"); const A2 = await mkBranch(A.id, "A2"); const B1 = await mkBranch(B.id, "B1");
  const branchesA = [{ id: A1.id }, { id: A2.id }];
  const userA = `iso-user-a-${tag}`; const userX = `iso-user-x-${tag}`;
  let n = 0;
  const mk = (tenantId: string, branchId: string, userId: string, extra: Record<string, unknown> = {}) =>
    delegate.create({ data: { ...o.row({ tenantId, branchId, userId, n: ++n }), createdBy: userId, ...extra } });
  const rA1own = await mk(A.id, A1.id, userA); const rA1other = await mk(A.id, A1.id, userX); const rA2 = await mk(A.id, A2.id, userA);
  const rB = await mk(B.id, B1.id, userA);
  const gone = new Date();
  const rDelA = await mk(A.id, A1.id, userA, { deletedAt: gone, deletedBy: userA });
  const rDelB = await mk(B.id, B1.id, userA, { deletedAt: gone, deletedBy: userA });

  const ctxAll = makeTestContext({ db: o.db, businessId: A.id, branches: branchesA, allowed: "all", userId: userA });
  const ctxA1 = makeTestContext({ db: o.db, businessId: A.id, branches: branchesA, allowed: [A1.id], picked: A1.id, userId: userA });
  const attempt = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };
  const ids = async (ctx: typeof ctxAll, scope: "own" | "branch" | "all", query = {}) =>
    (await o.repo.list(ctx, scope, { per: 200, ...query })).rows.map((r: AnyRow) => r.id as string);
  const reload = (id: string) => delegate.findUnique({ where: { id } });

  // 1. another business is invisible
  if (await o.repo.find(ctxAll, rB.id, "all")) bad("find() returned a row of another business");
  if (!(await attempt(() => o.repo.get(ctxAll, rB.id, "all")))) bad("get() returned a row of another business");
  const all = await ids(ctxAll, "all");
  if (all.includes(rB.id) || all.includes(rDelB.id)) bad("list() returned rows of another business");
  for (const r of [rA1own, rA1other, rA2]) if (!all.includes(r.id)) bad("list() with scope all missed a row of the business");
  const total = (await o.repo.list(ctxAll, "all", { per: 1 })).meta.total;
  if ((await o.repo.count(ctxAll, "all")) !== total) bad("count() and list().meta.total disagree");

  // 2. deleted rows are hidden
  if (all.includes(rDelA.id)) bad("list() returned a soft-deleted row");
  if (await o.repo.find(ctxAll, rDelA.id, "all")) bad("find() returned a soft-deleted row");

  // 3. branch scope: a member of A1 never sees A2
  for (const scope of ["branch", "all"] as const) {
    const got = await ids(ctxA1, scope);
    if (got.includes(rA2.id)) bad(`a member of one branch saw another branch's row (scope ${scope})`);
    if (!got.includes(rA1own.id)) bad(`a member of A1 did not see an A1 row (scope ${scope})`);
  }
  if (!(await attempt(() => o.repo.get(ctxA1, rA2.id, "all")))) bad("get() let a member of A1 open an A2 row");
  if (o.repo.branched && o.repo.config.filterable.branchId) {
    const widened = await ids(ctxA1, "all", { filters: [{ field: "branchId", op: "eq", value: A2.id }] });
    if (widened.includes(rA2.id)) bad("a branchId filter widened the branch scope");
  }

  // 4. own scope
  if (o.repo.config.ownerField) {
    const own = await ids(ctxAll, "own");
    if (own.includes(rA1other.id)) bad("scope own returned someone else's row");
    if (!own.includes(rA1own.id)) bad("scope own missed the person's own row");
  }

  // 5. writes across businesses are refused and change nothing
  const before = await reload(rB.id);
  if (!(await attempt(() => o.repo.update(ctxAll, rB.id, o.update.data, "all")))) bad("update() changed a row of another business");
  if (!(await attempt(() => o.repo.softDelete(ctxAll, rB.id, "all")))) bad("softDelete() deleted a row of another business");
  if (!(await attempt(() => o.repo.restore(ctxAll, rDelB.id, "all")))) bad("restore() restored a row of another business");
  if (o.transition && (await o.repo.transition(ctxAll, rB.id, o.transition.from, o.transition.to, "all"))) bad("transition() changed a row of another business");
  const after = await reload(rB.id); const afterDel = await reload(rDelB.id);
  if (!before || !after || after.version !== before.version || after[o.update.changedField] !== before[o.update.changedField] || after.deletedAt) bad("a refused cross-business write still changed the row");
  if (!afterDel || !afterDel.deletedAt) bad("restore() of another business's row took effect");

  // 6. create: the business comes from the context, the branch must be one the person works at
  const made = await o.repo.create(ctxAll, { ...o.createData({ branchId: A1.id }), tenantId: B.id }).catch(() => null);
  if (made && made.tenantId !== A.id) bad("create() accepted a tenantId from the caller");
  if (!(await attempt(() => o.repo.create(ctxA1, o.createData({ branchId: A2.id }))))) bad("create() allowed a branch the person does not work at");
  if (!(await attempt(() => o.repo.create(ctxAll, o.createData({ branchId: B1.id }))))) bad("create() allowed a branch of another business");

  // 7. own-business round trip still works: delete hides, restore shows
  await o.repo.softDelete(ctxAll, rA2.id, "all");
  if ((await ids(ctxAll, "all")).includes(rA2.id)) bad("softDelete() did not hide the row");
  await o.repo.restore(ctxAll, rA2.id, "all");
  if (!(await ids(ctxAll, "all")).includes(rA2.id)) bad("restore() did not bring the row back");
  return problems;
}

/** Registers one vitest test that fails with the list of problems. */
export function testRepositoryIsolation(name: string, o: IsolationOptions): void {
  it(`${name}: keeps businesses, branches and deleted rows apart`, async () => {
    expect(await runRepositoryIsolation(o)).toEqual([]);
  }, 60_000);
}
