// The PostgreSQL store of the event dispatcher: claims outbox rows with row locks so two API processes never take the same one.
// Where it fits: createDispatcher() (platform/src/jobs/dispatcher.ts) takes an OutboxStore; this is the real one, the tests also use a
// small in-memory one. It is a separate file so the dispatcher's own logic loads without the Prisma client.
// How it works: see PrismaOutboxStore below. Row locking is SELECT ... FOR UPDATE SKIP LOCKED inside one interactive transaction.
// Rules: the table is event_outbox (EventOutbox) and event_deliveries (EventDelivery); no column is added (P1-BE-4 has no migration).

import { Prisma } from "@prisma/client";
import type { Tx } from "../core/context.js";
import type { Db } from "../db/client.js";
import type { ClaimedBatch, ClaimOptions, OutboxStore } from "./dispatcher.js";

/** The ready test, also used by the PostgreSQL store: not dispatched, tries left, and its retry time has come. */
const ready = (now: Date, maxAttempts: number): Prisma.EventOutboxWhereInput => ({
  dispatchedAt: null, attempts: { lt: maxAttempts }, OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }],
});

/**
 * PostgreSQL store. Row locking: `SELECT id ... FOR UPDATE SKIP LOCKED` inside an interactive transaction (PostgreSQL 9.5+). The first
 * read (which rows look ready) is outside the transaction and cheap, so an empty outbox costs one query and no transaction. After the
 * lock the rows are read again with the ready test, so a row another process just finished or pushed back is not taken twice.
 */
export class PrismaOutboxStore implements OutboxStore {
  /** The transaction stays open while handlers run, so it needs more than Prisma's 5 seconds. */
  constructor(private readonly db: Db, private readonly txTimeoutMs = 120_000) {}

  async claim(o: ClaimOptions, work: (batch: ClaimedBatch) => Promise<void>): Promise<number> {
    const order = [{ createdAt: "asc" as const }, { id: "asc" as const }];
    const candidates = await this.db.eventOutbox.findMany({ where: ready(o.now, o.maxAttempts), orderBy: order, take: o.limit, select: { id: true } });
    if (!candidates.length) return 0;
    return this.db.$transaction(async (tx: Tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM event_outbox WHERE id IN (${Prisma.join(candidates.map((c) => c.id))}) AND dispatched_at IS NULL FOR UPDATE SKIP LOCKED`,
      );
      if (!locked.length) return 0;
      const rows = await tx.eventOutbox.findMany({ where: { id: { in: locked.map((l) => l.id) }, ...ready(o.now, o.maxAttempts) }, orderBy: order });
      if (!rows.length) return 0;
      const done = await tx.eventDelivery.findMany({ where: { eventId: { in: rows.map((r) => r.id) } }, select: { eventId: true, handlerId: true } });
      const delivered = new Map<string, Set<string>>();
      for (const d of done) delivered.set(d.eventId, (delivered.get(d.eventId) ?? new Set()).add(d.handlerId));
      await work({
        rows, delivered,
        recordDelivery: async (eventId, handlerId) => { await tx.eventDelivery.createMany({ data: [{ eventId, handlerId }], skipDuplicates: true }); },
        markDispatched: async (id, at) => { await tx.eventOutbox.update({ where: { id }, data: { dispatchedAt: at, nextTryAt: null } }); },
        markFailed: async (id, f) => { await tx.eventOutbox.update({ where: { id }, data: { attempts: f.attempts, nextTryAt: f.nextTryAt, lastError: f.lastError } }); },
      });
      return rows.length;
    }, { timeout: this.txTimeoutMs, maxWait: 10_000 });
  }
}
