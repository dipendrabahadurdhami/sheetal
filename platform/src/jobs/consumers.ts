// Registers event handlers from the app manifests: the only way a handler gets onto the bus.
// Where it fits: an API calls registerConsumers(bus, APPS, implementations) once when it is built, before the dispatcher's first tick.
// How it works: each manifest lists what it consumes in events.consumes ({ name, handler, why }); the code supplies the function for
// each handler id. This file checks that the two lists agree, then subscribes each one with the app that owns it.
// Rules: fail closed at startup, never at the first event. A manifest entry with no code throws; code that no manifest declares throws;
// a handler id must start with "<app id>." and be used once (EventDelivery is unique per event + handler, so one id is one
// subscription); a platform handler (platform: true) is for events with no business. Nothing here knows any app: the manifests come in
// as an argument (platform must not import apps).

import type { EventHandler, OutboxEventBus, PlatformEventHandler } from "../core/events.js";
import type { AppManifest } from "../core/manifest.js";

export type ConsumerImpl =
  | { run: EventHandler<never>; platform?: false }
  | { run: PlatformEventHandler<never>; platform: true };

/** The code for each handler id declared in a manifest's events.consumes. */
export type ConsumerImpls = Readonly<Record<string, ConsumerImpl>>;

export function registerConsumers(
  bus: Pick<OutboxEventBus, "subscribe">,
  manifests: readonly Pick<AppManifest, "id" | "events">[],
  impls: ConsumerImpls,
): () => void {
  const declared = new Map<string, { app: string; name: string }>();
  for (const m of manifests) {
    for (const sub of m.events.consumes) {
      if (!sub.handler.startsWith(`${m.id}.`)) throw new Error(`Handler "${sub.handler}" of app "${m.id}" must start with "${m.id}.".`);
      const twice = declared.get(sub.handler);
      if (twice) throw new Error(`Handler "${sub.handler}" is declared twice (${twice.app} for "${twice.name}", ${m.id} for "${sub.name}"). Use one handler id per consumed event.`);
      declared.set(sub.handler, { app: m.id, name: sub.name });
    }
  }
  for (const id of Object.keys(impls)) {
    if (!declared.has(id)) throw new Error(`Handler "${id}" has code but no manifest lists it in events.consumes.`);
  }
  const off: (() => void)[] = [];
  try {
    for (const [id, d] of declared) {
      const impl = impls[id];
      if (!impl) throw new Error(`App "${d.app}" says it consumes "${d.name}" with handler "${id}", but no code is registered for that handler.`);
      off.push(impl.platform === true
        ? bus.subscribe(d.name, impl.run as PlatformEventHandler<unknown>, { id, app: d.app, platform: true })
        : bus.subscribe(d.name, impl.run as EventHandler<unknown>, { id, app: d.app }));
    }
  } catch (err) {
    for (const f of off) f();   // all or nothing
    throw err;
  }
  return () => { for (const f of off) f(); };
}
