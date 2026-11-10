// Tests for BaseRepository (platform/src/core/repository.ts) on the real Expense table, plus the isolation helper itself.
// Needs the throwaway test database (started by backend-core/test/setup-db.ts). Run with: npm run test -w @sheetal/platform
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors.js";
import { runRepositoryIsolation, testRepositoryIsolation, type IsolationOptions } from "../src/core/testing/isolation.js";
import { makeTestContext } from "../src/core/testing/context.js";
import { ExpenseRepo, LeakyExpenseRepo, testDb } from "./expense-fixture.js";

const db = testDb();
const repo = new ExpenseRepo();
let ctx: ReturnType<typeof makeTestContext>;
let ctxOther: ReturnType<typeof makeTestContext>;
let branchA: string;

const isolation = (r: IsolationOptions["repo"]): IsolationOptions => ({
  db, repo: r, model: "expense",
  row: ({ tenantId, branchId, userId, n }) => ({ tenantId, branchId, spentOn: new Date("2026-11-01"), category: "other", amount: 100 + n, note: `iso ${userId}` }),
  createData: ({ branchId }) => ({ spentOn: new Date("2026-11-02"), category: "other", amount: 50, branchId }),
  update: { data: { note: "changed" }, changedField: "note" },
  transition: { from: { status: "confirmed" }, to: { status: "skipped" } },
});

beforeAll(async () => {
  const tag = randomUUID().slice(0, 8);
  await db.plan.create({ data: { id: `repo-plan-${tag}`, type: "test", name: "Repo plan", price: 0, limits: {}, features: {} } });
  const mk = async (n: string) => {
    const t = await db.tenant.create({ data: { name: `Repo ${n} ${tag}`, type: "test", planId: `repo-plan-${tag}` } });
    const b = await db.branch.create({ data: { tenantId: t.id, name: `Main ${n}` } });
    return { t, b };
  };
  const a = await mk("A"), o = await mk("B");
  branchA = a.b.id;
  ctx = makeTestContext({ db, businessId: a.t.id, branches: [{ id: a.b.id }], userId: "user-a" });
  ctxOther = makeTestContext({ db, businessId: o.t.id, branches: [{ id: o.b.id }], userId: "user-b" });
});
afterAll(async () => { await db.$disconnect(); });

const newRow = (note = "x") => repo.create(ctx, { spentOn: new Date("2026-11-03"), category: "rent", amount: 1500, note, branchId: branchA });

describe("BaseRepository on the Expense table", () => {
  it("create sets the business, creator, version and the branch", async () => {
    const r = await newRow();
    expect(r.tenantId).toBe(ctx.business.id);
    expect(r.createdBy).toBe("user-a");
    expect(r.version).toBe(1);
    expect(r.branchId).toBe(branchA);
  });
  it("create ignores owner-only fields sent by the caller", async () => {
    const r = await repo.create(ctx, { spentOn: new Date("2026-11-03"), category: "rent", amount: 1, branchId: branchA, version: 99, deletedAt: new Date(), tenantId: ctxOther.business.id } as never);
    expect(r.version).toBe(1); expect(r.deletedAt).toBeNull(); expect(r.tenantId).toBe(ctx.business.id);
  });
  it("another business cannot see, change or delete the row", async () => {
    const r = await newRow();
    expect(await repo.find(ctxOther, r.id, "all")).toBeNull();
    await expect(repo.get(ctxOther, r.id, "all")).rejects.toMatchObject({ statusCode: 404 });
    await expect(repo.update(ctxOther, r.id, { note: "hijack" }, "all", 1)).rejects.toMatchObject({ statusCode: 404 });
    await expect(repo.softDelete(ctxOther, r.id, "all")).rejects.toMatchObject({ statusCode: 404 });
    expect((await repo.get(ctx, r.id, "all")).note).toBe("x");
  });
  it("update bumps the version and a stale version is a 409 version_conflict", async () => {
    const r = await newRow();
    const u = await repo.update(ctx, r.id, { note: "second" }, "all", 1);
    expect(u.version).toBe(2); expect(u.updatedBy).toBe("user-a");
    const err = await repo.update(ctx, r.id, { note: "late" }, "all", 1).catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 409, code: "version_conflict" });
    expect((await repo.get(ctx, r.id, "all")).note).toBe("second");
  });
  it("two saves of the same version: one wins, one is refused", async () => {
    const r = await newRow();
    const results = await Promise.allSettled([repo.update(ctx, r.id, { note: "p" }, "all", 1), repo.update(ctx, r.id, { note: "q" }, "all", 1)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await repo.get(ctx, r.id, "all")).version).toBe(2);
  });
  it("soft delete hides the row, restore brings it back, both bump the version", async () => {
    const r = await newRow();
    await repo.softDelete(ctx, r.id, "all");
    expect(await repo.find(ctx, r.id, "all")).toBeNull();
    expect((await repo.find(ctx, r.id, "all", { includeDeleted: true }))?.deletedBy).toBe("user-a");
    const back = await repo.restore(ctx, r.id, "all");
    expect(back.deletedAt).toBeNull(); expect(back.version).toBe(3);
  });
  it("transition changes the row only while it still looks like `from`", async () => {
    const r = await newRow();
    expect(await repo.transition(ctx, r.id, { status: "confirmed" }, { status: "skipped" }, "all")).toBe(true);
    expect(await repo.transition(ctx, r.id, { status: "confirmed" }, { status: "skipped" }, "all")).toBe(false);
  });
  it("list pages, sorts, filters and searches, and refuses unknown fields", async () => {
    const note = `findme-${randomUUID().slice(0, 6)}`;
    await newRow(note); await newRow(note);
    const page = await repo.list(ctx, "all", { q: note, per: 1, page: 2 });
    expect(page.rows).toHaveLength(1); expect(page.meta).toMatchObject({ total: 2, current_page: 2, last_page: 2, per_page: 1 });
    await expect(repo.list(ctx, "all", { filters: [{ field: "tenantId", op: "eq", value: "x" }] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list(ctx, "all", { sort: [{ field: "note", dir: "asc" }] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(repo.list(ctx, "all", { filters: [{ field: "status", op: "contains", value: "x" }] })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("per page is capped", async () => {
    expect((await repo.list(ctx, "all", { per: 100000 })).meta.per_page).toBe(200);
  });
});

describe("repository isolation helper", () => {
  testRepositoryIsolation("ExpenseRepo", isolation(repo));

  it("finds the problems in a repository that forgets the business", async () => {
    const problems = await runRepositoryIsolation(isolation(new LeakyExpenseRepo()));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" | ")).toMatch(/another business/);
  });
});
