// Domain events and the bus apps use to talk to each other (KERNEL.md section 9).
// Where it fits: services call bus.publish() inside their transaction; the dispatcher (P1-BE-4) delivers the rows later.
// How it works: publish() inserts an EventOutbox row with the caller's transaction, so the event commits or rolls back with
// the change itself. Handlers are registered with subscribe() and run at least once, once per handler id (EventDelivery).
// Rules: an event name is "<app>.<resource>.<past-tense verb>" in lower case. The payload is small JSON (ids and paisa
// amounts, no secrets, no files). Platform events with no business (nightly billing run, demo cleanup, staff actions) are
// allowed: tenantId and businessId are then null.
// Delivery (P1-BE-4): platform/src/jobs/dispatcher.ts reads the outbox rows and calls the handlers registered here. A handler is
// registered for business events (it gets a SystemContext of the event's business and never sees another business) or, with
// `platform: true`, for platform events with no business (it gets a context with no business at all). A business event is never
// handed to a platform handler, and the other way round. Without an attached dispatcher, start() and drain() say so instead of pretending.

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Actor, BaseContext, SystemContext } from "./context.js";

export interface DomainEvent<P = unknown> {
  id: string;                    // uuid; also the idempotency key
  name: string;                  // "expenses.expense.confirmed"
  v: number;                     // payload version, starts at 1
  at: Date;
  businessId: string | null;     // null for platform events with no business
  branchId: string | null;
  actor: Actor;
  requestId: string;
  payload: P;
}

export interface EventHandlerOptions {
  id: string;                    // unique handler id, e.g. "invoicing.on-expense-confirmed". Used for "run once per event".
  app: string;                   // the app that owns the handler; must list the event in manifest.events.consumes
  /** true = this handler is for platform events (no business, tenantId null) and gets a PlatformEventContext. Default false. */
  platform?: boolean;
}

export type EventHandler<P = unknown> = (e: DomainEvent<P>, ctx: SystemContext) => Promise<void>;

/** What a platform handler runs with: the basics of a context (database, log, transaction) with the handler as the actor, and no business. */
export type PlatformEventContext = BaseContext & { readonly actor: { kind: "system"; job: string } };
export type PlatformEventHandler<P = unknown> = (e: DomainEvent<P>, ctx: PlatformEventContext) => Promise<void>;

/** What the dispatcher offers the bus (platform/src/jobs/dispatcher.ts). */
export interface AttachedDispatcher { start(): void; drain(): Promise<unknown> }

export interface EventBus {
  /** Writes an EventOutbox row inside ctx.tx (so it commits or rolls back with the change). */
  publish<P>(ctx: BaseContext, name: string, payload: P, v?: number, opts?: { branchId?: string | null }): Promise<void>;
  subscribe<P>(pattern: string, handler: EventHandler<P>, opts: EventHandlerOptions & { platform?: false }): () => void;
  subscribe<P>(pattern: string, handler: PlatformEventHandler<P>, opts: EventHandlerOptions & { platform: true }): () => void;
  /** Starts the attached dispatcher on its own timer (scripts, workers). The APIs list dispatcher.job() in their jobs registry instead. */
  start(): void;
  /** Tests: deliver everything waiting now and wait for it. */
  drain(): Promise<void>;
}

/** "<app>.<resource>.<verb>": three or more lower-case segments (letters, digits, hyphens). */
export const EVENT_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;

/** Whole-segment wildcards only: "expenses.*" matches "expenses.expense.confirmed"; "*.expense.confirmed" matches too. */
export function matchesPattern(pattern: string, name: string): boolean {
  const p = pattern.split(".");
  const n = name.split(".");
  if (p[p.length - 1] === "*") { // a trailing * covers every remaining segment
    return n.length >= p.length && p.slice(0, -1).every((seg, i) => seg === "*" || seg === n[i]);
  }
  return p.length === n.length && p.every((seg, i) => seg === "*" || seg === n[i]);
}

export interface Subscription { pattern: string; handler: (e: DomainEvent<never>, ctx: never) => Promise<void>; opts: EventHandlerOptions }

export interface OutboxBusOptions {
  /** Whether the app may publish this event name (the manifest's events.publishes; P1-BE-2 supplies it). Without it, any
   *  well-formed name passes. */
  mayPublish?: (name: string) => boolean;
  /** true (development, tests): an unlisted event throws. false (production): it is logged and still written. */
  strict?: boolean;
}

export class OutboxEventBus implements EventBus {
  private readonly subs: Subscription[] = [];
  private dispatcher: AttachedDispatcher | null = null;
  constructor(private readonly o: OutboxBusOptions = {}) {}

  async publish<P>(ctx: BaseContext, name: string, payload: P, v = 1, opts: { branchId?: string | null } = {}): Promise<void> {
    if (!EVENT_NAME.test(name)) throw new Error(`Event name "${name}" must look like "app.resource.verb" in lower case.`);
    if (!Number.isInteger(v) || v < 1) throw new Error("An event payload version starts at 1.");
    if (!ctx.tx) throw new Error(`Event "${name}" must be published inside ctx.transaction(), so it commits with the change.`);
    if (this.o.mayPublish && !this.o.mayPublish(name)) {
      const msg = `Event "${name}" is not listed in the publishing app's manifest (events.publishes).`;
      if (this.o.strict ?? true) throw new Error(msg);
      ctx.log.warn({ event: name }, msg);
    }
    const businessId = "business" in ctx ? (ctx as { business: { id: string } }).business.id : null;
    await ctx.tx.eventOutbox.create({
      data: {
        id: randomUUID(), name, v,
        payload: (payload ?? null) as Prisma.InputJsonValue,
        tenantId: businessId, branchId: opts.branchId ?? null,
        actor: ctx.actor as unknown as Prisma.InputJsonValue,
        requestId: ctx.requestId,
      },
    });
  }

  /** Registers a handler. Returns a function that removes it. The dispatcher reads handlersFor(). */
  subscribe<P>(pattern: string, handler: EventHandler<P>, opts: EventHandlerOptions & { platform?: false }): () => void;
  subscribe<P>(pattern: string, handler: PlatformEventHandler<P>, opts: EventHandlerOptions & { platform: true }): () => void;
  subscribe<P>(pattern: string, handler: EventHandler<P> | PlatformEventHandler<P>, opts: EventHandlerOptions): () => void {
    if (!pattern.split(".").every((s) => s === "*" || /^[a-z][a-z0-9-]*$/.test(s))) throw new Error(`"${pattern}" is not a valid event pattern.`);
    if (this.subs.some((s) => s.opts.id === opts.id)) throw new Error(`Event handler "${opts.id}" is already registered.`);
    const sub: Subscription = { pattern, handler: handler as Subscription["handler"], opts };
    this.subs.push(sub);
    return () => { const i = this.subs.indexOf(sub); if (i >= 0) this.subs.splice(i, 1); };
  }

  handlersFor(name: string): readonly Subscription[] { return this.subs.filter((s) => matchesPattern(s.pattern, name)); }

  /** Connects the dispatcher (createDispatcher in platform/src/jobs/dispatcher.ts calls this). */
  attach(d: AttachedDispatcher): void { this.dispatcher = d; }

  start(): void {
    if (!this.dispatcher) throw new Error("No event dispatcher is attached to this bus (P1-BE-4): build one with createDispatcher() from platform/src/jobs/dispatcher.ts.");
    this.dispatcher.start();
  }
  async drain(): Promise<void> {
    if (!this.dispatcher) throw new Error("No event dispatcher is attached to this bus (P1-BE-4): there is nothing to drain.");
    await this.dispatcher.drain();
  }
}
