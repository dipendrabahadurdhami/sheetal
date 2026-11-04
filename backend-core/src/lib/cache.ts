// Cache for pages, search results, settings and rate limits.
// Where it fits: app.cache in every API; cached() wraps slow public lists.
// How it works: Redis when REDIS_URL is set (shared by all API processes), otherwise an in-memory map (one process).
// Rules: clear the matching prefix when the underlying data changes (e.g. "catalog:" after a listing changes).

import { Redis } from "ioredis";

export interface Cache {
  readonly kind: "redis" | "memory";
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Remove every key starting with `prefix` (e.g. all cached searches after a listing changes). */
  delPrefix(prefix: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryCache implements Cache {
  readonly kind = "memory" as const;
  private store = new Map<string, { value: unknown; expires: number }>();
  constructor(private readonly maxEntries = 5000) {}

  async get<T>(key: string) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) { this.store.delete(key); return undefined; }
    return hit.value as T;
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
  async del(key: string) { this.store.delete(key); }
  async delPrefix(prefix: string) { for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k); }
  async ping() { return true; }
  async close() { this.store.clear(); }
}

export class RedisCache implements Cache {
  readonly kind = "redis" as const;
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string) {
    const raw = await this.redis.get(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }
  async set(key: string, value: unknown, ttlSeconds: number) { await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds); }
  async del(key: string) { await this.redis.del(key); }
  async delPrefix(prefix: string) {
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      if (keys.length) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  }
  async ping() {
    try { return (await this.redis.ping()) === "PONG"; } catch { return false; }
  }
  async close() { await this.redis.quit(); }
}

export function createCache(redisUrl?: string): Cache {
  if (!redisUrl) return new MemoryCache();
  return new RedisCache(new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: false }));
}

/** Return the cached value, or compute it, store it for `ttlSeconds` and return it. */
export async function cached<T>(cache: Cache, key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await compute();
  await cache.set(key, value, ttlSeconds);
  return value;
}
