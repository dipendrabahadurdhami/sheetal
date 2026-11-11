// What Rentals needs from the API process it runs in: the database, the media folder, the event bus, and a system context for the bill job.
// Where it fits: routes.ts and jobs.ts read these from the Fastify app. The business API decorates the app with `db`, `config` and (at the end of buildApp) `events`.
// How it works: small read-only accessors with their own types, so this app does not depend on how the business API declares them. `events` is looked up at
// the moment it is used, not when the routes are registered: the business API creates the bus AFTER it registers the routes.
// Rules: no logic here beyond looking things up. If the bus is missing when an event must be written, say so (never skip the event silently).

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { EventBus } from "@sheetal/platform/core/events";
import type { Db } from "@sheetal/platform/db/client";
import { buildSystemContext } from "@sheetal/platform/tenancy/system-context";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import type { BillEvents } from "./bills.js";

type Host = FastifyInstance & { db?: Db; config?: { MEDIA_DIR?: string }; events?: { bus: EventBus } };

export function dbOf(app: FastifyInstance): Db {
  const db = (app as Host).db;
  if (!db) throw new Error("The rentals app needs the database (app.db).");
  return db;
}

export const mediaDirOf = (app: FastifyInstance): string | undefined => (app as Host).config?.MEDIA_DIR;

/** The bus of this process, as the services use it: looked up on every publish. */
export function busOf(app: FastifyInstance): EventBus {
  const bus = () => {
    const b = (app as Host).events?.bus;
    if (!b) throw new Error("The event bus is not started on this app (app.events), so the rentals event cannot be written.");
    return b;
  };
  return {
    publish: (ctx, name, payload, v, opts) => bus().publish(ctx, name, payload, v, opts),
    subscribe: ((pattern: string, handler: never, opts: never) => (bus().subscribe as (...a: unknown[]) => () => void)(pattern, handler, opts)) as EventBus["subscribe"],
    start: () => bus().start(),
    drain: () => bus().drain(),
  };
}

/**
 * What the bill generator needs to write events: the bus, and a context of each business (acting as the system).
 * A missing bus is an error (never add a bill without its event). Only the old stand-alone entry point startRentJob(), used by code that builds an app
 * without the bus, passes `allowNoBus` and gets undefined.
 */
export function billEventsOf(app: FastifyInstance, o: { allowNoBus?: boolean } = {}): BillEvents | undefined {
  if (!(app as Host).events) {
    if (o.allowNoBus) return undefined;
    throw new Error("The event bus is not started on this app (app.events), so rent bills would be added without their events.");
  }
  return {
    bus: busOf(app),
    contextFor: (tenantId) => buildSystemContext({ db: dbOf(app), log: app.log, tenantId, handlerId: "rentals.bills", requestId: randomUUID() }, { effectiveLimits: (d, t, p) => effectiveLimits(d, t, p) }),
  };
}
