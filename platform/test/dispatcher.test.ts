// Tests of the event dispatcher's delivery logic (platform/src/jobs/dispatcher.ts) on an in-memory store: no database needed.
// Where it fits: the real PostgreSQL store (row locking, rollback) is tested in dispatcher-db.test.ts; this file proves what the dispatcher
// decides: once per handler, retry with backoff, dead letters, who may see which event, and that a second dispatcher never repeats a delivery.
// How it works: MemoryStore keeps outbox rows in a Map and behaves like FOR UPDATE SKIP LOCKED: rows claimed by one tick are invisible to
// another tick until the first one ends. The clock is a variable the tests move.
// Run with: npm run test -w @sheetal/platform
import { describe, expect, it, vi } from "vitest";
import { OutboxEventBus } from "../src/core/events.js";
import { createDispatcher, type ClaimedBatch, type ClaimOptions, type OutboxRow, type OutboxStore } from "../src/jobs/dispatcher.js";

class MemoryStore implements OutboxStore {
  rows = new Map<string, OutboxRow & { dispatchedAt: Date | null; nextTryAt: Date | null; lastError: string | null }>();
  deliveries = new Map<string, Set<string>>();
  private locked = new Set<string>();
  add(r: Partial<OutboxRow> & { id: string; name: string }): void {
    this.rows.set(r.id, { v: 1, payload: {}, tenantId: "biz-a", branchId: null, actor: { kind: "user", userId: "u1", name: "U" }, requestId: "req", createdAt: new Date(2026, 10, 10, 0, 0, this.rows.size), attempts: 0, dispatchedAt: null, nextTryAt: null, lastError: null, ...r });
  }
  async claim(o: ClaimOptions, work: (b: ClaimedBatch) => Promise<void>): Promise<number> {
    const ready = [...this.rows.values()]
      .filter((r) => !r.dispatchedAt && r.attempts < o.maxAttempts && (!r.nextTryAt || r.nextTryAt <= o.now) && !this.locked.has(r.id))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, o.limit);
    if (!ready.length) return 0;
    ready.forEach((r) => this.locked.add(r.id));
    try {
      await work({
        rows: ready.map((r) => ({ ...r })),
        delivered: new Map(ready.map((r) => [r.id, new Set(this.deliveries.get(r.id) ?? [])])),
        recordDelivery: async (id, h) => { this.deliveries.set(id, (this.deliveries.get(id) ?? new Set()).add(h)); },
        markDispatched: async (id, at) => { const r = this.rows.get(id)!; r.dispatchedAt = at; r.nextTryAt = null; },
        markFailed: async (id, f) => { Object.assign(this.rows.get(id)!, f); },
      });
    } finally { ready.forEach((r) => this.locked.delete(r.id)); }
    return ready.length;
  }
}

const logger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() });
const T0 = new Date("2026-11-10T06:00:00Z");

function setup(over: { maxAttempts?: number; handlerTimeoutMs?: number } = {}) {
  const store = new MemoryStore();
  const bus = new OutboxEventBus();
  const log = logger();
  const clock = { now: new Date(T0) };
  const forBusiness = vi.fn(async (a: { tenantId: string; handlerId: string }) => ({ business: { id: a.tenantId }, actor: { kind: "system", job: a.handlerId } }) as never);
  const dispatcher = createDispatcher({
    store, bus, db: {} as never, log: log as never, contexts: { forBusiness },
    maxAttempts: over.maxAttempts ?? 8, backoffMs: (n) => 1000 * n, now: () => clock.now, ...(over.handlerTimeoutMs ? { handlerTimeoutMs: over.handlerTimeoutMs } : {}),
  });
  const at = (ms: number) => { clock.now = new Date(T0.getTime() + ms); };
  return { store, bus, log, dispatcher, forBusiness, at };
}

describe("delivery: once per handler", () => {
  it("calls every matching handler once, records a delivery for each, and marks the event dispatched", async () => {
    const { store, bus, dispatcher } = setup();
    const a = vi.fn(async () => {}), b = vi.fn(async () => {}), other = vi.fn(async () => {});
    bus.subscribe("expenses.*", a, { id: "invoicing.on-expense", app: "invoicing" });
    bus.subscribe("*.expense.confirmed", b, { id: "reports.on-expense", app: "reports" });
    bus.subscribe("reviews.*", other, { id: "x.on-review", app: "x" });
    store.add({ id: "e1", name: "expenses.expense.confirmed", payload: { amountPaisa: 150000 } });
    const r = await dispatcher.tick();
    expect(r).toMatchObject({ claimed: 1, delivered: 2, dispatched: 1, failed: 0 });
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1); expect(other).not.toHaveBeenCalled();
    expect([...store.deliveries.get("e1")!].sort()).toEqual(["invoicing.on-expense", "reports.on-expense"]);
    expect(store.rows.get("e1")!.dispatchedAt).toEqual(T0);
    expect((await dispatcher.tick()).claimed).toBe(0);            // nothing left: never delivered again
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("hands the handler the event as published (id, name, version, business, branch, actor, request, payload)", async () => {
    const { store, bus, dispatcher } = setup();
    const seen: unknown[] = [];
    bus.subscribe("expenses.*", async (e) => { seen.push(e); }, { id: "h.one", app: "h" });
    store.add({ id: "e1", name: "expenses.expense.confirmed", v: 2, tenantId: "biz-a", branchId: "br-1", payload: { id: "x1" }, requestId: "req-9" });
    await dispatcher.tick();
    expect(seen[0]).toMatchObject({ id: "e1", name: "expenses.expense.confirmed", v: 2, businessId: "biz-a", branchId: "br-1", requestId: "req-9", payload: { id: "x1" }, actor: { kind: "user" } });
  });

  it("an event nobody handles is marked dispatched at once", async () => {
    const { store, dispatcher } = setup();
    store.add({ id: "e1", name: "reviews.review.added" });
    expect(await dispatcher.tick()).toMatchObject({ claimed: 1, dispatched: 1, delivered: 0 });
    expect(store.rows.get("e1")!.dispatchedAt).not.toBeNull();
  });

  it("drain() works until nothing is ready and leaves events that wait for a retry", async () => {
    const { store, bus, dispatcher } = setup();
    bus.subscribe("a.*", async () => {}, { id: "h.ok", app: "h" });
    bus.subscribe("b.*", async () => { throw new Error("nope"); }, { id: "h.bad", app: "h" });
    store.add({ id: "e1", name: "a.thing.done" }); store.add({ id: "e2", name: "a.thing.done" }); store.add({ id: "e3", name: "b.thing.done" });
    const r = await dispatcher.drain();
    expect(r).toMatchObject({ dispatched: 2, failed: 1 });
    expect(store.rows.get("e3")).toMatchObject({ attempts: 1, dispatchedAt: null });
  });
});

describe("failures: retry with backoff, then dead", () => {
  it("retries after a growing delay and ends as a dead letter after the maximum", async () => {
    const { store, bus, log, dispatcher, at } = setup({ maxAttempts: 3 });
    const h = vi.fn(async () => { throw new Error("boom"); });
    bus.subscribe("a.*", h, { id: "h.bad", app: "h" });
    store.add({ id: "e1", name: "a.thing.done" });

    expect(await dispatcher.tick()).toMatchObject({ failed: 1, dead: 0 });
    expect(store.rows.get("e1")).toMatchObject({ attempts: 1, dispatchedAt: null, nextTryAt: new Date(T0.getTime() + 1000) });
    expect(store.rows.get("e1")!.lastError).toBe("h.bad: boom");

    at(999);
    expect((await dispatcher.tick()).claimed).toBe(0);               // too early: the retry time has not come
    expect(h).toHaveBeenCalledTimes(1);

    at(1000);
    expect(await dispatcher.tick()).toMatchObject({ failed: 1, dead: 0 });
    expect(store.rows.get("e1")).toMatchObject({ attempts: 2, nextTryAt: new Date(T0.getTime() + 1000 + 2000) });   // the delay grew

    at(3000);
    expect(await dispatcher.tick()).toMatchObject({ failed: 1, dead: 1 });
    expect(store.rows.get("e1")).toMatchObject({ attempts: 3, dispatchedAt: null, nextTryAt: null });             // dead: stays undelivered, no retry time
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ eventId: "e1", attempts: 3 }), expect.stringContaining("dead letter"));

    at(999_999);
    expect((await dispatcher.tick()).claimed).toBe(0);               // a dead letter is never picked up again
    expect(h).toHaveBeenCalledTimes(3);
  });

  it("one failing handler does not block the others, and a retry runs only the handler that is missing", async () => {
    const { store, bus, dispatcher, at } = setup();
    const good = vi.fn(async () => {});
    let tries = 0;
    const flaky = vi.fn(async () => { if (++tries === 1) throw new Error("first time fails"); });
    bus.subscribe("a.*", flaky, { id: "h.flaky", app: "h" });
    bus.subscribe("a.*", good, { id: "h.good", app: "h" });
    store.add({ id: "e1", name: "a.thing.done" });

    expect(await dispatcher.tick()).toMatchObject({ delivered: 1, failed: 1 });
    expect(good).toHaveBeenCalledTimes(1);                           // ran although the other one failed
    expect([...store.deliveries.get("e1")!]).toEqual(["h.good"]);

    at(1000);
    expect(await dispatcher.tick()).toMatchObject({ delivered: 1, dispatched: 1, failed: 0 });
    expect(good).toHaveBeenCalledTimes(1);                           // not repeated: it already has a delivery row
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(store.rows.get("e1")!.dispatchedAt).not.toBeNull();
  });

  it("a handler that takes too long counts as failed", async () => {
    const { store, bus, dispatcher } = setup({ handlerTimeoutMs: 20 });
    bus.subscribe("a.*", () => new Promise<void>(() => {}), { id: "h.stuck", app: "h" });
    store.add({ id: "e1", name: "a.thing.done" });
    expect(await dispatcher.tick()).toMatchObject({ failed: 1 });
    expect(store.rows.get("e1")!.lastError).toMatch(/h\.stuck: Handler h\.stuck took longer than/);
  });

  it("a context that cannot be built is a failed delivery, never a handler that runs without one", async () => {
    const { store, bus, dispatcher, forBusiness } = setup();
    forBusiness.mockRejectedValueOnce(new Error("Business gone"));
    const h = vi.fn(async () => {});
    bus.subscribe("a.*", h, { id: "h.one", app: "h" });
    store.add({ id: "e1", name: "a.thing.done" });
    expect(await dispatcher.tick()).toMatchObject({ failed: 1 });
    expect(h).not.toHaveBeenCalled();
    expect(store.rows.get("e1")!.lastError).toContain("Business gone");
  });
});

describe("a handler only sees its event's business", () => {
  it("builds the context from the event's own business, for the handler's id", async () => {
    const { store, bus, dispatcher, forBusiness } = setup();
    const ctxs: { business: { id: string } }[] = [];
    bus.subscribe("a.*", async (_e, ctx) => { ctxs.push(ctx as never); }, { id: "h.one", app: "h" });
    store.add({ id: "e1", name: "a.thing.done", tenantId: "biz-a" });
    store.add({ id: "e2", name: "a.thing.done", tenantId: "biz-b" });
    await dispatcher.tick();
    expect(forBusiness).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "biz-a", handlerId: "h.one" }));
    expect(forBusiness).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "biz-b", handlerId: "h.one" }));
    expect(ctxs.map((c) => c.business.id)).toEqual(["biz-a", "biz-b"]);   // each call got its own business, in order
  });

  it("a platform event (tenantId null) goes to platform handlers only, with a context that has no business", async () => {
    const { store, bus, dispatcher, forBusiness } = setup();
    const business = vi.fn(async () => {});
    const platform = vi.fn(async (_e: unknown, ctx: unknown) => { void ctx; });
    bus.subscribe("billing.*", business, { id: "x.business-side", app: "x" });
    bus.subscribe("billing.*", platform, { id: "billing.platform-side", app: "billing", platform: true });
    store.add({ id: "p1", name: "billing.cycle.ran", tenantId: null });
    store.add({ id: "b1", name: "billing.cycle.ran", tenantId: "biz-a" });
    await dispatcher.tick();
    expect(platform).toHaveBeenCalledTimes(1);                       // only the platform event
    expect(business).toHaveBeenCalledTimes(1);                       // only the business event
    expect(forBusiness).toHaveBeenCalledTimes(1);
    const [e, ctx] = platform.mock.calls[0] as unknown as [{ businessId: string | null }, Record<string, unknown>];
    expect(e.businessId).toBeNull();
    expect(ctx).not.toHaveProperty("business");
    expect(ctx).not.toHaveProperty("branches");
    expect(ctx).not.toHaveProperty("permissions");
    expect(ctx.actor).toEqual({ kind: "system", job: "billing.platform-side" });
    expect(typeof ctx.transaction).toBe("function");
  });
});

describe("two dispatchers at the same time", () => {
  it("never deliver the same event twice (the second skips rows the first holds)", async () => {
    const store = new MemoryStore();
    const bus = new OutboxEventBus();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    bus.subscribe("a.*", async (e) => { calls.push(e.id); await gate; }, { id: "h.slow", app: "h" });
    const mk = () => createDispatcher({ store, bus: { handlersFor: (n) => bus.handlersFor(n) }, db: {} as never, log: logger() as never, contexts: { forBusiness: async () => ({}) as never }, batchSize: 5, now: () => T0 });
    for (let i = 0; i < 8; i++) store.add({ id: `e${i}`, name: "a.thing.done" });
    const d1 = mk(), d2 = mk();
    const first = d1.tick();                                         // takes e0..e4 and waits inside the handler
    await new Promise((r) => setTimeout(r, 10));
    const second = d2.tick();                                        // may only take what is left: e5..e7
    await new Promise((r) => setTimeout(r, 10));
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.claimed).toBe(5);
    expect(r2.claimed).toBe(3);
    expect(calls.sort()).toEqual([...Array(8).keys()].map((i) => `e${i}`));   // each event exactly once
    expect(new Set(calls).size).toBe(calls.length);
  });
});

describe("a tick is short", () => {
  it("leaves the rows it had no time for to the next tick, and always handles at least one", async () => {
    const store = new MemoryStore();
    const bus = new OutboxEventBus();
    const h = vi.fn(async () => { await new Promise((r) => setTimeout(r, 15)); });
    bus.subscribe("a.*", h, { id: "h.slow", app: "h" });
    const d = createDispatcher({ store, bus, db: {} as never, log: logger() as never, contexts: { forBusiness: async () => ({}) as never }, tickBudgetMs: 5, now: () => T0 });
    for (let i = 0; i < 3; i++) store.add({ id: `e${i}`, name: "a.thing.done" });
    expect(await d.tick()).toMatchObject({ claimed: 3, dispatched: 1 });   // the first took longer than the budget: the others wait
    expect([...store.rows.values()].filter((r) => r.dispatchedAt).length).toBe(1);
    await d.drain();
    expect(h).toHaveBeenCalledTimes(3);                                    // each exactly once in the end
    expect([...store.rows.values()].every((r) => r.dispatchedAt)).toBe(true);
  });
});

describe("the tick budget is checked before every handler (QA, P1-BE-4 fix 1)", () => {
  it("stops between two handlers of one row, keeps the finished delivery, does not count a failure, and runs only the rest next tick", async () => {
    const store = new MemoryStore();
    const bus = new OutboxEventBus();
    let t = 0;                                                      // fake milliseconds: each handler "takes" 40 s
    const slow = (id: string) => vi.fn(async () => { t += 40_000; void id; });
    const h1 = slow("1"), h2 = slow("2"), h3 = slow("3");
    bus.subscribe("a.*", h1, { id: "h.one", app: "h" });
    bus.subscribe("a.*", h2, { id: "h.two", app: "h" });
    bus.subscribe("a.*", h3, { id: "h.three", app: "h" });
    const d = createDispatcher({ store, bus, db: {} as never, log: logger() as never, contexts: { forBusiness: async () => ({}) as never }, now: () => T0, elapsedMs: () => t });
    store.add({ id: "e1", name: "a.thing.done" });

    const first = await d.tick();                                   // 0 s: h1 runs (40 s); 40 s: h2 runs (80 s > 60 s budget); h3 waits
    expect(first).toMatchObject({ claimed: 1, delivered: 2, dispatched: 0, failed: 0 });
    expect(store.deliveries.get("e1")).toEqual(new Set(["h.one", "h.two"]));
    const row = store.rows.get("e1")!;
    expect(row).toMatchObject({ attempts: 0, dispatchedAt: null, lastError: null });   // not a failure: it simply ran out of time

    t = 0;
    expect(await d.tick()).toMatchObject({ delivered: 1, dispatched: 1 });
    expect([h1.mock.calls.length, h2.mock.calls.length, h3.mock.calls.length]).toEqual([1, 1, 1]);   // each handler exactly once
    expect(store.rows.get("e1")!.dispatchedAt).not.toBeNull();
  });
});

describe("the bus and the job", () => {
  it("drain() and start() on a bus without a dispatcher say so; with one, drain() delivers", async () => {
    const bus = new OutboxEventBus();
    await expect(bus.drain()).rejects.toThrow(/P1-BE-4/);
    expect(() => bus.start()).toThrow(/P1-BE-4/);
    const store = new MemoryStore();
    const h = vi.fn(async () => {});
    bus.subscribe("a.*", h, { id: "h.one", app: "h" });
    createDispatcher({ store, bus, db: {} as never, log: logger() as never, contexts: { forBusiness: async () => ({}) as never }, now: () => T0 });
    store.add({ id: "e1", name: "a.thing.done" });
    await bus.drain();
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("is a job that runs every 5 seconds, first after 2 seconds (\"every few seconds\"), and runs a tick", async () => {
    const { store, bus, dispatcher } = setup();
    const h = vi.fn(async () => {});
    bus.subscribe("a.*", h, { id: "h.one", app: "h" });
    store.add({ id: "e1", name: "a.thing.done" });
    const job = dispatcher.job();
    expect(job).toMatchObject({ id: "events.dispatcher", everyMs: 5000, firstRunMs: 2000 });
    await job.run();
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("refuses silly limits", () => {
    expect(() => createDispatcher({ store: new MemoryStore(), bus: new OutboxEventBus(), db: {} as never, log: logger() as never, contexts: { forBusiness: async () => ({}) as never }, maxAttempts: 0 })).toThrow();
  });
});
