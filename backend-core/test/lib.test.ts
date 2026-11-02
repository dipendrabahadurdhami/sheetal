import { describe, expect, it, vi } from "vitest";
import { isBotRequest, isBotUserAgent, isSearchEngine } from "../src/lib/bots.js";
import { MemoryCache, cached } from "../src/lib/cache.js";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("bots", () => {
  it("lets real browsers through", () => {
    expect(isBotUserAgent(CHROME)).toBe(false);
    expect(isBotRequest({ "user-agent": CHROME, "accept-language": "en-US,ne;q=0.8" })).toBe(false);
  });
  it("catches crawlers, scrapers, AI bots, tools and headless browsers", () => {
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "python-requests/2.31", "curl/8.4.0", "Mozilla/5.0 GPTBot/1.0", "Mozilla/5.0 HeadlessChrome/130.0", "x"]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
  });
  it("treats a browser without Accept-Language as a bot", () => {
    expect(isBotRequest({ "user-agent": CHROME })).toBe(true);
  });
  it("knows real search engines", () => {
    expect(isSearchEngine("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isSearchEngine("python-requests/2.31")).toBe(false);
  });
});

describe("memory cache", () => {
  it("stores, expires and clears by prefix", async () => {
    vi.useFakeTimers();
    const c = new MemoryCache();
    await c.set("search:a", [1], 10);
    await c.set("search:b", [2], 10);
    await c.set("listing:1", { id: 1 }, 10);
    expect(await c.get("search:a")).toEqual([1]);
    await c.delPrefix("search:");
    expect(await c.get("search:b")).toBeUndefined();
    expect(await c.get("listing:1")).toEqual({ id: 1 });
    vi.advanceTimersByTime(11_000);
    expect(await c.get("listing:1")).toBeUndefined();
    vi.useRealTimers();
  });
  it("drops the oldest entry when full", async () => {
    const c = new MemoryCache(2);
    await c.set("a", 1, 60); await c.set("b", 2, 60); await c.set("c", 3, 60);
    expect(await c.get("a")).toBeUndefined();
    expect(await c.get("c")).toBe(3);
  });
  it("computes once, then serves from cache", async () => {
    const c = new MemoryCache();
    const compute = vi.fn(async () => "slow result");
    expect(await cached(c, "k", 60, compute)).toBe("slow result");
    expect(await cached(c, "k", 60, compute)).toBe("slow result");
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
