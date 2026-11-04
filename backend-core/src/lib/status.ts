// Health of an API's own parts, for /health/ready and Admin → System status.
// How it works: checks the database and the cache and reports their state and speed.

import type { Cache } from "./cache.js";
import { pingDb, type Db } from "./db.js";

export type ServiceState = "up" | "down" | "off";
export interface ServiceStatus { id: string; name: string; state: ServiceState; ms: number | null; detail?: string }

async function timed(check: () => Promise<boolean>): Promise<[boolean, number]> {
  const start = performance.now();
  const ok = await check().catch(() => false);
  return [ok, Math.round(performance.now() - start)];
}

export async function collectStatus(deps: { db?: Db; cache: Cache }): Promise<{ ok: boolean; services: ServiceStatus[] }> {
  const [[dbOk, dbMs], [cacheOk, cacheMs]] = await Promise.all([timed(() => pingDb(deps.db)), timed(() => deps.cache.ping())]);
  const services: ServiceStatus[] = [
    deps.db
      ? { id: "db", name: "Database (PostgreSQL)", state: dbOk ? "up" : "down", ms: dbMs }
      : { id: "db", name: "Database (PostgreSQL)", state: "off", ms: null, detail: "DATABASE_URL is not set" },
    { id: "cache", name: deps.cache.kind === "redis" ? "Cache (Redis)" : "Cache (in memory)", state: cacheOk ? "up" : "down", ms: cacheMs, detail: deps.cache.kind === "memory" ? "Local mode; use Redis in production" : undefined },
  ];
  return { ok: services.every((s) => s.state === "up"), services };
}
