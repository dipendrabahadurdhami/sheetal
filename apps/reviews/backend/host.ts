// What Reviews needs from the API process it runs in: the database and the event bus.
// Where it fits: routes.ts reads these from the Fastify app. The business API decorates the app with `db` and (at the end of buildApp) `events`.
// How it works: small accessors with their own types, so this app does not depend on how the business API declares them. `events` is looked up when used,
// not when the routes are registered: the business API creates the bus AFTER it registers the routes.
// Rules: if the bus is missing when an event must be written, say so (never skip the event silently).

import type { FastifyInstance } from "fastify";
import type { EventBus } from "@sheetal/platform/core/events";

type Host = FastifyInstance & { events?: { bus: EventBus } };

/** The bus of this process, as the service uses it: looked up on every publish. */
export function busOf(app: FastifyInstance): EventBus {
  const bus = () => {
    const b = (app as Host).events?.bus;
    if (!b) throw new Error("The event bus is not started on this app (app.events), so the reviews event cannot be written.");
    return b;
  };
  return {
    publish: (ctx, name, payload, v, opts) => bus().publish(ctx, name, payload, v, opts),
    subscribe: ((pattern: string, handler: never, opts: never) => (bus().subscribe as (...a: unknown[]) => () => void)(pattern, handler, opts)) as EventBus["subscribe"],
    start: () => bus().start(),
    drain: () => bus().drain(),
  };
}
