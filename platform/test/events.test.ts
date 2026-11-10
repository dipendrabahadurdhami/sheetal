// Tests for the event bus (platform/src/core/events.ts): the outbox row commits or rolls back with the caller's transaction.
// Needs the throwaway test database. Run with: npm run test -w @sheetal/platform
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENT_NAME, OutboxEventBus, matchesPattern } from "../src/core/events.js";
import { makeTestContext } from "../src/core/testing/context.js";
import { testDb } from "./expense-fixture.js";

const db = testDb();
let ctx: ReturnType<typeof makeTestContext>;
const bus = new OutboxEventBus();
const rowsOf = (name: string) => db.eventOutbox.findMany({ where: { name } });

beforeAll(async () => {
  const tag = randomUUID().slice(0, 8);
  await db.plan.create({ data: { id: `ev-plan-${tag}`, type: "test", name: "Event plan", price: 0, limits: {}, features: {} } });
  const t = await db.tenant.create({ data: { name: `Events ${tag}`, type: "test", planId: `ev-plan-${tag}` } });
  const b = await db.branch.create({ data: { tenantId: t.id, name: "Main" } });
  ctx = makeTestContext({ db, businessId: t.id, branches: [{ id: b.id }] });
});
afterAll(async () => { await db.$disconnect(); });

describe("OutboxEventBus.publish", () => {
  it("writes one outbox row inside the transaction and keeps it on commit", async () => {
    const name = `tests.thing.made-${randomUUID().slice(0, 6)}`;
    await ctx.transaction((c) => bus.publish(c, name, { id: "1", amountPaisa: 150000 }, 1, { branchId: "br" }));
    const rows = await rowsOf(name);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: ctx.business.id, branchId: "br", v: 1, dispatchedAt: null, attempts: 0, requestId: "test-request" });
    expect(rows[0]!.payload).toEqual({ id: "1", amountPaisa: 150000 });
    expect(rows[0]!.actor).toMatchObject({ kind: "user" });
  });
  it("leaves no row when the transaction rolls back", async () => {
    const name = `tests.thing.lost-${randomUUID().slice(0, 6)}`;
    await expect(ctx.transaction(async (c) => { await bus.publish(c, name, { id: "2" }); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await rowsOf(name)).toHaveLength(0);
  });
  it("refuses to publish outside a transaction", async () => {
    await expect(bus.publish(ctx, "tests.thing.made", {})).rejects.toThrow(/transaction/);
  });
  it("a platform event (no business) has a null tenant", async () => {
    const name = `tests.billing.ran-${randomUUID().slice(0, 6)}`;
    // A context with no business at all (a nightly job): only the BaseContext fields.
    const full = makeTestContext({ db, businessId: ctx.business.id, branches: [] });
    const { requestId, ip, now, log } = full;
    const mk = (tx: unknown) => ({
      requestId, ip, now, log, db, actor: { kind: "system" as const, job: "nightly" }, tx,
      transaction: (fn: (c: unknown) => Promise<unknown>) => db.$transaction((t) => fn(mk(t))),
    });
    const platformCtx = mk(null);
    await platformCtx.transaction((c) => bus.publish(c as never, name, {}));
    expect((await rowsOf(name))[0]!.tenantId).toBeNull();
  });
  it("checks the name, the version and the manifest list", async () => {
    await expect(ctx.transaction((c) => bus.publish(c, "Bad Name", {}))).rejects.toThrow(/lower case/);
    await expect(ctx.transaction((c) => bus.publish(c, "tests.thing", {}))).rejects.toThrow();
    await expect(ctx.transaction((c) => bus.publish(c, "tests.thing.made", {}, 0))).rejects.toThrow(/version/);
    const strict = new OutboxEventBus({ mayPublish: (n) => n.startsWith("expenses.") });
    await expect(ctx.transaction((c) => strict.publish(c, "reviews.review.added", {}))).rejects.toThrow(/manifest/);
    await ctx.transaction((c) => strict.publish(c, "expenses.expense.created", {}));
  });
});

describe("event names and patterns", () => {
  it("accepts app.resource.verb and refuses the rest", () => {
    expect(EVENT_NAME.test("expenses.expense.confirmed")).toBe(true);
    expect(EVENT_NAME.test("expenses.expense")).toBe(false);
    expect(EVENT_NAME.test("Expenses.expense.confirmed")).toBe(false);
  });
  it("matches whole segments; a trailing * covers the rest", () => {
    expect(matchesPattern("expenses.expense.confirmed", "expenses.expense.confirmed")).toBe(true);
    expect(matchesPattern("expenses.*.confirmed", "expenses.expense.confirmed")).toBe(true);
    expect(matchesPattern("expenses.*", "expenses.expense.confirmed")).toBe(true);
    expect(matchesPattern("*.expense.confirmed", "reviews.expense.confirmed")).toBe(true);
    expect(matchesPattern("expenses.expense.conf", "expenses.expense.confirmed")).toBe(false);
    expect(matchesPattern("reviews.*", "expenses.expense.confirmed")).toBe(false);
  });
  it("subscribe registers, finds and removes handlers; the dispatcher is not built yet", () => {
    const b = new OutboxEventBus();
    const off = b.subscribe("expenses.*", async () => {}, { id: "h1" } as never);
    expect(b.handlersFor("expenses.expense.confirmed")).toHaveLength(1);
    expect(() => b.subscribe("expenses.*", async () => {}, { id: "h1" } as never)).toThrow(/already/);
    off();
    expect(b.handlersFor("expenses.expense.confirmed")).toHaveLength(0);
    expect(() => b.start()).toThrow(/P1-BE-4/);
  });
});
