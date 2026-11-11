// What an app needs from the API process it runs in: the event bus (one copy for every app).
// Where it fits: apps/*/backend import busOf() from here instead of each keeping its own copy (P1-BE-7; Expenses and Reviews had two identical ones).
// How it works: the API decorates its Fastify app with `events` (the bus and its dispatcher) at the END of buildApp(), after the routes are registered.
// So busOf() hands out a small bus that looks the real one up at the moment it is used, not when the routes are registered.
// Rules: if the bus is missing when an event must be written, say so (never skip the event silently). `what` names the event in the message
// ("expenses" -> "...so the expenses event cannot be written."), so the messages the apps had before are unchanged.

import type { FastifyInstance } from "fastify";
import type { EventBus } from "./events.js";

type Host = FastifyInstance & { events?: { bus: EventBus } };

/** The bus of this process, as the services use it: looked up on every publish. */
export function busOf(app: FastifyInstance, what: string): EventBus {
  const bus = () => {
    const b = (app as Host).events?.bus;
    if (!b) throw new Error(`The event bus is not started on this app (app.events), so the ${what} event cannot be written.`);
    return b;
  };
  return {
    publish: (ctx, name, payload, v, opts) => bus().publish(ctx, name, payload, v, opts),
    subscribe: ((pattern: string, handler: never, opts: never) => (bus().subscribe as (...a: unknown[]) => () => void)(pattern, handler, opts)) as EventBus["subscribe"],
    start: () => bus().start(),
    drain: () => bus().drain(),
  };
}
