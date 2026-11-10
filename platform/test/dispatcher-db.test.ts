// Tests of the event dispatcher on the real database (platform/src/jobs/outbox-store.ts + dispatcher.ts): the parts only PostgreSQL can show.
// Where it fits: dispatcher.test.ts proves the delivery logic without a database; this file proves the row locking (two dispatchers never
// deliver an event twice), that the outbox row and the delivery rows commit together, that a rolled-back publish leaves nothing to
// deliver, and that a handler is given the context of its event's business only.
// How it works: needs the throwaway test database (backend-core/test/setup-db.ts, started once per run). Event names carry a random
// tag, and every test handler listens only to its own tag, so other test files' rows are marked dispatched and otherwise ignored.
// Run with: npm run test -w @sheetal/platform
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OutboxEventBus } from "../src/core/events.js";
import { makeTestContext } from "../src/core/testing/context.js";
import { createDispatcher } from "../src/jobs/dispatcher.js";
import { PrismaOutboxStore } from "../src/jobs/outbox-store.js";
import { buildSystemContext } from "../src/tenancy/system-context.js";
import { testDb } from "./expense-fixture.js";

const db = testDb();
const tag = randomUUID().slice(0, 6);
const name = (what: string) => `dbtest${tag}.thing.${what}`;
const quiet = { warn: () => {}, error: vi.fn(), info: () => {}, debug: () => {} } as never;
const deps = { effectiveLimits: async (_db: unknown, _id: string, plan: { limits: unknown }) => ({ limits: plan.limits }) };

let a: ReturnType<typeof makeTestContext>;
let b: ReturnType<typeof makeTestContext>;
const clock = { now: new Date() };

beforeAll(async () => {
  await db.plan.create({ data: { id: `dbd-plan-${tag}`, type: "test", name: "Dispatcher plan", price: 0, limits: {}, features: {} } });
  const mk = async (label: string) => {
    const t = await db.tenant.create({ data: { name: `Dispatch ${label} ${tag}`, type: "test", planId: `dbd-plan-${tag}` } });
    const br = await db.branch.create({ data: { tenantId: t.id, name: "Main" } });
    return makeTestContext({ db, businessId: t.id, branches: [{ id: br.id }] });
  };
  a = await mk("A");
  b = await mk("B");
  // Rows left by other test files have no handler here: mark them done so they never crowd a batch.
  await db.eventOutbox.updateMany({ where: { dispatchedAt: null }, data: { dispatchedAt: new Date() } });
});
afterAll(async () => { await db.$disconnect(); });

/** A dispatcher over the real store with its own bus. `backoffMs` is 1 s per try; the clock is `clock`. */
function make(over: { maxAttempts?: number; batchSize?: number } = {}) {
  const bus = new OutboxEventBus();
  const dispatcher = createDispatcher({
    store: new PrismaOutboxStore(db), bus, db, log: quiet,
    contexts: { forBusiness: (x) => buildSystemContext({ db, log: quiet, ...x }, deps) },
    backoffMs: (n) => 1000 * n, now: () => clock.now, ...over,
  });
  return { bus, dispatcher };
}
const publish = (ctx: typeof a, what: string, payload: object = {}) => ctx.transaction((c) => new OutboxEventBus().publish(c, name(what), payload));
const rowOf = async (what: string, ctx = a) => (await db.eventOutbox.findFirstOrThrow({ where: { name: name(what), tenantId: ctx.business.id } }));

describe("delivery on the database", () => {
  it("delivers once per handler: a delivery row each, the outbox row marked dispatched, and nothing the second time", async () => {
    const { bus, dispatcher } = make();
    const h1 = vi.fn(async () => {}), h2 = vi.fn(async () => {});
    bus.subscribe(`dbtest${tag}.*`, h1, { id: `t${tag}.one`, app: "t" });
    bus.subscribe(`dbtest${tag}.thing.once`, h2, { id: `t${tag}.two`, app: "t" });
    await publish(a, "once", { n: 1 });
    await dispatcher.drain();
    await dispatcher.drain();
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    const row = await rowOf("once");
    expect(row.dispatchedAt).not.toBeNull();
    const deliveries = await db.eventDelivery.findMany({ where: { eventId: row.id } });
    expect(deliveries.map((d) => d.handlerId).sort()).toEqual([`t${tag}.one`, `t${tag}.two`]);
  });

  it("a failing handler retries with backoff and ends as a dead letter after the maximum; the other handler ran only once", async () => {
    const { bus, dispatcher } = make({ maxAttempts: 3 });
    const good = vi.fn(async () => {});
    const bad = vi.fn(async () => { throw new Error("boom"); });
    bus.subscribe(name("flaky"), bad, { id: `t${tag}.bad`, app: "t" });
    bus.subscribe(name("flaky"), good, { id: `t${tag}.good`, app: "t" });
    clock.now = new Date();
    const t0 = clock.now.getTime();
    await publish(a, "flaky");
    await dispatcher.tick();
    let row = await rowOf("flaky");
    expect(row).toMatchObject({ attempts: 1, dispatchedAt: null });
    expect(row.lastError).toBe(`t${tag}.bad: boom`);
    expect(row.nextTryAt!.getTime()).toBe(t0 + 1000);

    clock.now = new Date(t0 + 999);
    expect((await dispatcher.tick()).claimed).toBe(0);                // too early
    clock.now = new Date(t0 + 1000);
    await dispatcher.tick();
    clock.now = new Date(t0 + 3000);
    await dispatcher.tick();
    row = await rowOf("flaky");
    expect(row).toMatchObject({ attempts: 3, dispatchedAt: null, nextTryAt: null });   // dead letter
    expect(bad).toHaveBeenCalledTimes(3);
    expect(good).toHaveBeenCalledTimes(1);                            // its delivery row stopped a repeat
    clock.now = new Date(t0 + 999_999);
    expect((await dispatcher.tick()).claimed).toBe(0);
    clock.now = new Date();
  });

  it("two dispatchers running at once deliver every event exactly once (FOR UPDATE SKIP LOCKED)", async () => {
    const seen: string[] = [];
    const mkSide = () => {
      const { bus, dispatcher } = make({ batchSize: 4 });
      bus.subscribe(name("many"), async (e) => { seen.push(e.id); await new Promise((r) => setTimeout(r, 25)); }, { id: `t${tag}.many`, app: "t" });
      return dispatcher;
    };
    // Each side has its own bus but the same handler id: they compete for the same rows, like two API processes.
    const d1 = mkSide(), d2 = mkSide();
    for (let i = 0; i < 12; i++) await publish(a, "many", { i });
    const results = await Promise.all([d1.drain(), d2.drain()]);
    expect(results[0]!.claimed + results[1]!.claimed).toBe(12);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);                              // no event twice
    expect(await db.eventOutbox.count({ where: { name: name("many"), dispatchedAt: null } })).toBe(0);
    expect(await db.eventDelivery.count({ where: { handlerId: `t${tag}.many` } })).toBe(12);
  });
});

describe("what is written with the publishing transaction", () => {
  it("a rolled-back publish leaves nothing to deliver", async () => {
    const { bus, dispatcher } = make();
    const h = vi.fn(async () => {});
    bus.subscribe(name("lost"), h, { id: `t${tag}.lost`, app: "t" });
    await expect(a.transaction(async (c) => { await new OutboxEventBus().publish(c, name("lost"), {}); throw new Error("rolled back"); })).rejects.toThrow("rolled back");
    expect(await db.eventOutbox.count({ where: { name: name("lost") } })).toBe(0);
    await dispatcher.drain();
    expect(h).not.toHaveBeenCalled();
  });

  it("a committed publish is delivered after the commit, not before", async () => {
    const { bus, dispatcher } = make();
    const h = vi.fn(async () => {});
    bus.subscribe(name("later"), h, { id: `t${tag}.later`, app: "t" });
    await a.transaction(async (c) => {
      await new OutboxEventBus().publish(c, name("later"), {});
      await dispatcher.drain();                                       // the row is not committed yet: invisible to the dispatcher
      expect(h).not.toHaveBeenCalled();
    });
    await dispatcher.drain();
    expect(h).toHaveBeenCalledTimes(1);
  });
});

describe("isolation: a handler sees only its event's business", () => {
  it("each call gets the context of the event's own business, a system actor, and a repository-safe tenant", async () => {
    const { bus, dispatcher } = make();
    const got: { event: string | null; ctxBusiness: string; actor: unknown; owner: boolean; seats: unknown; branches: number }[] = [];
    bus.subscribe(name("iso"), async (e, ctx) => {
      got.push({ event: e.businessId, ctxBusiness: ctx.business.id, actor: ctx.actor, owner: ctx.permissions.can("anything.at.all"), seats: ctx.entitlements.seats(), branches: ctx.branches.mine.length });
    }, { id: `t${tag}.iso`, app: "t" });
    await publish(a, "iso"); await publish(b, "iso");
    await dispatcher.drain();
    expect(got).toHaveLength(2);
    for (const g of got) {
      expect(g.ctxBusiness).toBe(g.event);                            // never another business
      expect(g.actor).toEqual({ kind: "system", job: `t${tag}.iso` });
      expect(g.owner).toBe(true);                                     // "*" ...
      expect(g.branches).toBe(1);                                     // ... but only this business's branches
    }
    expect(new Set(got.map((g) => g.ctxBusiness))).toEqual(new Set([a.business.id, b.business.id]));
  });

  it("a transaction opened by a handler uses the system actor and the same business", async () => {
    const { bus, dispatcher } = make();
    let seen: { actor: unknown; business: string; inTx: boolean } | null = null;
    bus.subscribe(name("tx"), async (_e, ctx) => {
      await ctx.transaction(async (c) => { seen = { actor: c.actor, business: c.business.id, inTx: c.tx !== null }; });
    }, { id: `t${tag}.tx`, app: "t" });
    await publish(b, "tx");
    await dispatcher.drain();
    expect(seen).toEqual({ actor: { kind: "system", job: `t${tag}.tx` }, business: b.business.id, inTx: true });
  });

  it("a platform event (no business) reaches platform handlers only, with no business in the context", async () => {
    const { bus, dispatcher } = make();
    const business = vi.fn(async () => {});
    const platform = vi.fn(async (_e: unknown, ctx: unknown) => { void ctx; });
    bus.subscribe(name("plat"), business, { id: `t${tag}.biz-side`, app: "t" });
    bus.subscribe(name("plat"), platform, { id: `t${tag}.plat-side`, app: "t", platform: true });
    // A context with no business at all (a nightly job), as in events.test.ts.
    const { requestId, ip, now, log } = a;
    const mk = (tx: unknown) => ({ requestId, ip, now, log, db, actor: { kind: "system" as const, job: "nightly" }, tx, transaction: (fn: (c: unknown) => Promise<unknown>) => db.$transaction((t) => fn(mk(t))) });
    await mk(null).transaction((c) => new OutboxEventBus().publish(c as never, name("plat"), {}));
    expect((await db.eventOutbox.findFirstOrThrow({ where: { name: name("plat") } })).tenantId).toBeNull();
    await dispatcher.drain();
    expect(platform).toHaveBeenCalledTimes(1);
    expect(business).not.toHaveBeenCalled();
    expect(platform.mock.calls[0]![1]).not.toHaveProperty("business");
  });

  it("a business that does not exist cannot be handled: the event fails and is retried, never run with an empty context", async () => {
    const { bus, dispatcher } = make({ maxAttempts: 2 });
    const h = vi.fn(async () => {});
    bus.subscribe(name("ghost"), h, { id: `t${tag}.ghost`, app: "t" });
    // The outbox has no foreign key to tenants, so a row can name a business that is gone.
    const ghost = await db.eventOutbox.create({ data: { id: randomUUID(), name: name("ghost"), payload: {}, tenantId: "no-such-business", actor: { kind: "system", job: "x" } } });
    await dispatcher.tick();
    expect(h).not.toHaveBeenCalled();
    const after = await db.eventOutbox.findUniqueOrThrow({ where: { id: ghost.id } });
    expect(after).toMatchObject({ attempts: 1, dispatchedAt: null });
    expect(after.lastError).toContain("does not exist");
  });
});
