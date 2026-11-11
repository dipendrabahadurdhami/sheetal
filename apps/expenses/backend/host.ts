// What Expenses needs from the API process it runs in: the database, the media folder, and a system context for jobs (the event bus helper busOf() is shared: platform core/host.ts).
// Where it fits: routes.ts and jobs.ts read these from the Fastify app. The business API decorates the app with `db`, `config` and (at the end of buildApp) `events`.
// How it works: small read-only accessors with their own types, so this app does not depend on how the business API declares them. `events` is looked up at
// the moment it is used, not when the routes are registered: the business API creates the bus AFTER it registers the routes.
// Rules: no logic here beyond looking things up. If the bus is missing when an event must be written, say so (never skip the event silently).

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { busOf } from "@sheetal/platform/core/host";
import type { EventBus } from "@sheetal/platform/core/events";
import type { Db } from "@sheetal/platform/db/client";
import { buildSystemContext } from "@sheetal/platform/tenancy/system-context";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import type { DraftEvents } from "./recurring.js";

type Host = FastifyInstance & { db?: Db; config?: { MEDIA_DIR?: string }; events?: { bus: EventBus } };

export function dbOf(app: FastifyInstance): Db {
  const db = (app as Host).db;
  if (!db) throw new Error("The expenses app needs the database (app.db).");
  return db;
}

export const mediaDirOf = (app: FastifyInstance): string | undefined => (app as Host).config?.MEDIA_DIR;

/**
 * What the draft generator needs to write events: the bus, and a context of each business (acting as the system).
 * A missing bus is an error (QA, P1-BE-5 fix 4: never add a draft without its event). Only the old stand-alone entry point
 * startExpenseJob(), used by tests that build an app without the bus, passes `allowNoBus` and gets undefined.
 */
export function draftEventsOf(app: FastifyInstance, o: { allowNoBus?: boolean } = {}): DraftEvents | undefined {
  if (!(app as Host).events) {
    if (o.allowNoBus) return undefined;
    throw new Error("The event bus is not started on this app (app.events), so recurring drafts would be added without their events.");
  }
  return {
    bus: busOf(app, "expenses"),
    contextFor: (tenantId) => buildSystemContext({ db: dbOf(app), log: app.log, tenantId, handlerId: "expenses.recurring", requestId: randomUUID() }, { effectiveLimits: (d, t, p) => effectiveLimits(d, t, p) }),
  };
}
