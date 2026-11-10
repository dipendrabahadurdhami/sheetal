// The event dispatcher: delivers the events that EventBus.publish() wrote to the outbox (KERNEL.md section 9).
// Where it fits: createDispatcher() is called once per API process with the bus the apps subscribed to; the API lists
// dispatcher.job() in its jobs registry (platform/src/jobs/registry.ts), so it starts and stops with the other timers.
// How it works: every tick it claims a batch of ready outbox rows (not dispatched, fewer than maxAttempts tries, next_try_at passed)
// with SELECT ... FOR UPDATE SKIP LOCKED inside one transaction, so two API processes never take the same row: the second one skips the
// rows the first holds and works on others. For each row it calls every handler that matches the event name and the event's kind
// (business handlers for business events, platform handlers for events with no business), one after the other. A handler that
// succeeded gets an EventDelivery row (unique per event + handler), so a retry only runs the handlers still missing. When every handler
// has a delivery row (or there is none) the row is marked dispatched. When some failed, attempts goes up and next_try_at is set with a
// growing delay (30 s, 1 min, 2 min... up to 1 hour); after maxAttempts (8) tries the row stays undelivered as a dead letter
// (attempts >= maxAttempts, dispatched_at empty), which Admin → System status lists. One failing handler never blocks the others.
// The rows of a tick stay locked until it ends, so a tick is kept short: handlers time out after 30 s and a tick stops taking new rows after 60 s.
// Rules: delivery is at least once per handler (a crash after a handler's work and before the commit runs it again), so handlers must be
// safe to repeat. A business handler gets a SystemContext of the event's business only. Order is by creation time inside one batch; a
// retried event can arrive after newer ones (strict order per business is NOT promised: see CHANGES-P1-BE-4). All time comes from
// `now()`, so tests move the clock instead of waiting. The database part sits behind OutboxStore, so the delivery logic runs without
// a database in unit tests; PrismaOutboxStore (platform/src/jobs/outbox-store.ts) is the real one.

import type { FastifyBaseLogger } from "fastify";
import type { Actor, SystemContext, Tx } from "../core/context.js";
import type { DomainEvent, PlatformEventContext, Subscription } from "../core/events.js";
import type { Db } from "../db/client.js";
import { JobRegistry, type JobSpec } from "./registry.js";

// ───────────── The store (the only part that talks to the database) ─────────────

export interface OutboxRow {
  id: string; name: string; v: number; payload: unknown;
  tenantId: string | null; branchId: string | null; actor: unknown; requestId: string | null;
  createdAt: Date; attempts: number;
}

/** A claimed batch: rows nobody else can take until the claim ends. Everything written through it commits or rolls back together. */
export interface ClaimedBatch {
  rows: readonly OutboxRow[];
  /** Handler ids that already have a delivery row, per event id. */
  delivered: ReadonlyMap<string, ReadonlySet<string>>;
  recordDelivery(eventId: string, handlerId: string): Promise<void>;
  markDispatched(eventId: string, at: Date): Promise<void>;
  markFailed(eventId: string, f: { attempts: number; nextTryAt: Date | null; lastError: string }): Promise<void>;
}

export interface ClaimOptions { now: Date; limit: number; maxAttempts: number }

export interface OutboxStore {
  /** Claims ready rows and runs `work` on them; returns how many rows were claimed (work is not called for zero). */
  claim(o: ClaimOptions, work: (batch: ClaimedBatch) => Promise<void>): Promise<number>;
}

// ───────────── Contexts for handlers ─────────────

/** Builds the context of a business handler. buildSystemContext() in platform/src/tenancy/system-context.ts is the real one. */
export interface SystemContextFactory {
  forBusiness(a: { tenantId: string; handlerId: string; requestId: string; now: Date }): Promise<SystemContext>;
}

/** The context of a platform handler: no business, the handler as the actor, a real transaction(). */
export function platformEventContext(a: { db: Db; log: FastifyBaseLogger; handlerId: string; requestId: string; now: Date }): PlatformEventContext {
  const actor = { kind: "system", job: a.handlerId } as const;
  const make = (tx: Tx | null): PlatformEventContext => ({
    requestId: a.requestId, ip: "system", now: a.now, actor, db: a.db, tx, log: a.log,
    transaction: (async (fn: (c: PlatformEventContext) => Promise<unknown>) =>
      tx ? fn(make(tx)) : a.db.$transaction(async (t) => fn(make(t)))) as PlatformEventContext["transaction"],
  });
  return make(null);
}

// ───────────── The dispatcher ─────────────

export interface HandlerSource { handlersFor(name: string): readonly Subscription[] }

export interface DispatcherOptions {
  store: OutboxStore;
  /** The bus the apps subscribed to (OutboxEventBus). */
  bus: HandlerSource & { attach?(d: { start(): void; drain(): Promise<unknown> }): void };
  db: Db;
  log: FastifyBaseLogger;
  contexts: SystemContextFactory;
  /** Tries before a row becomes a dead letter. Default 8 (KERNEL.md section 9). */
  maxAttempts?: number;
  /** Rows claimed per tick. Default 20. */
  batchSize?: number;
  /** Milliseconds to wait after the nth failed try (n starts at 1). Default 30 s doubling, at most 1 hour. */
  backoffMs?: (attempts: number) => number;
  /** A handler that takes longer than this counts as failed. Default 30 s. */
  handlerTimeoutMs?: number;
  /** After this long in one tick, the rows (and handlers) not yet run are left for the next tick (the rows stay locked while a tick runs, so a
   *  tick must be short; PrismaOutboxStore's transaction allows 120 s). Checked before each handler. At least one handler always runs. Default 60 s. */
  tickBudgetMs?: number;
  /** The clock. Tests move it. */
  now?: () => Date;
  /** Milliseconds for the tick budget (default Date.now). Tests use a fake one. */
  elapsedMs?: () => number;
  /** Job timing. Defaults: every 5 s, first run after 2 s ("every few seconds"). */
  everyMs?: number;
  firstRunMs?: number;
}

export interface TickResult { claimed: number; delivered: number; failed: number; dead: number; dispatched: number }

export interface Dispatcher {
  /** One pass: claim a batch, deliver, record. */
  tick(): Promise<TickResult>;
  /** Passes until nothing is ready (tests, and OutboxEventBus.drain()). Events waiting for a retry time are not ready. */
  drain(): Promise<TickResult>;
  /** The registry entry: add it to the API's job list. */
  job(): JobSpec;
  /** Standalone timer for scripts and workers (the APIs use job() instead). */
  start(): void;
  stop(): Promise<void>;
}

export const DEFAULT_MAX_ATTEMPTS = 8;
const defaultBackoff = (attempts: number) => Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 300);

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds.`)), ms); timer.unref(); });
  return Promise.race([p, limit]).finally(() => { if (timer) clearTimeout(timer); });
}

export function createDispatcher(o: DispatcherOptions): Dispatcher {
  const max = o.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const limit = o.batchSize ?? 20;
  const backoff = o.backoffMs ?? defaultBackoff;
  const handlerTimeout = o.handlerTimeoutMs ?? 30_000;
  const budget = o.tickBudgetMs ?? 60_000;
  const clock = o.now ?? (() => new Date());
  if (max < 1 || limit < 1) throw new Error("The dispatcher needs maxAttempts and batchSize of at least 1.");

  const eventOf = (r: OutboxRow): DomainEvent => ({
    id: r.id, name: r.name, v: r.v, at: r.createdAt, businessId: r.tenantId, branchId: r.branchId,
    actor: r.actor as Actor, requestId: r.requestId ?? r.id, payload: r.payload,
  });

  async function tick(): Promise<TickResult> {
    const res: TickResult = { claimed: 0, delivered: 0, failed: 0, dead: 0, dispatched: 0 };
    const now = clock();
    const ms = o.elapsedMs ?? Date.now;
    const started = ms();
    // Out of time? Checked before every row AND before every handler (QA, P1-BE-4 fix 1): one row with several slow handlers must not
    // push the transaction past its 120 s limit. A row stopped half-way keeps the deliveries already recorded (they commit with the
    // tick) and is NOT marked failed, so the next tick runs only the handlers still missing. At least one handler always runs per tick.
    const outOfTime = () => res.delivered + res.dispatched + res.failed > 0 && ms() - started > budget;
    let stopped = false;
    res.claimed = await o.store.claim({ now, limit, maxAttempts: max }, async (batch) => {
      for (const row of batch.rows) {
        if (outOfTime()) break;   // the rest are picked up by the next tick
        // A business event goes to business handlers, a platform event (no business) to platform handlers, never the other way round.
        const subs = o.bus.handlersFor(row.name).filter((s) => !!s.opts.platform === (row.tenantId === null));
        const done = batch.delivered.get(row.id) ?? new Set<string>();
        const errors: string[] = [];
        for (const s of subs) {
          const handlerId = s.opts.id;
          if (done.has(handlerId)) continue;
          if (outOfTime()) { stopped = true; break; }
          try {
            const requestId = row.requestId ?? row.id;
            const ctx = row.tenantId === null
              ? platformEventContext({ db: o.db, log: o.log, handlerId, requestId, now })
              : await o.contexts.forBusiness({ tenantId: row.tenantId, handlerId, requestId, now });
            await withTimeout((s.handler as (e: DomainEvent, c: unknown) => Promise<void>)(eventOf(row), ctx), handlerTimeout, `Handler ${handlerId}`);
            await batch.recordDelivery(row.id, handlerId);
            res.delivered++;
          } catch (err) {
            errors.push(`${handlerId}: ${messageOf(err)}`);
            o.log.warn({ event: row.name, eventId: row.id, handler: handlerId, attempt: row.attempts + 1, err }, "event handler failed");
          }
        }
        if (stopped) break;   // half-way through this row: leave it as it is (its finished deliveries are kept)
        if (!errors.length) {
          await batch.markDispatched(row.id, now);
          res.dispatched++;
          continue;
        }
        const attempts = row.attempts + 1;
        const dead = attempts >= max;
        await batch.markFailed(row.id, { attempts, nextTryAt: dead ? null : new Date(now.getTime() + backoff(attempts)), lastError: errors.join("; ").slice(0, 1000) });
        res.failed++;
        if (dead) { res.dead++; o.log.error({ event: row.name, eventId: row.id, attempts }, "event is a dead letter: every try failed"); }
      }
    });
    return res;
  }

  async function drain(): Promise<TickResult> {
    const total: TickResult = { claimed: 0, delivered: 0, failed: 0, dead: 0, dispatched: 0 };
    for (let i = 0; i < 1000; i++) {
      const r = await tick();
      if (!r.claimed) break;
      for (const k of Object.keys(total) as (keyof TickResult)[]) total[k] += r[k];
    }
    return total;
  }

  const job = (): JobSpec => ({
    id: "events.dispatcher", everyMs: o.everyMs ?? 5_000, firstRunMs: o.firstRunMs ?? 2_000,
    run: async () => { await tick(); },
    failMessage: "event dispatcher failed",
  });

  let own: JobRegistry | null = null;
  const dispatcher: Dispatcher = {
    tick, drain, job,
    start() { if (own) return; own = new JobRegistry(o.log).add(job()); own.start(); },
    async stop() { const r = own; own = null; if (r) await r.stop(); },
  };
  o.bus.attach?.({ start: () => dispatcher.start(), drain });
  return dispatcher;
}
