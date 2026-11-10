// Tests for the helpers behind the API hooks (requests.js): the address builder, the response split, and the race (an older answer arriving late must not
// overwrite a newer one). The race is tested on makeLoader, the piece useApiList uses to decide whose answer counts.
import { describe, expect, it } from "vitest";
import { buildUrl, invalidate, makeLoader, splitResponse } from "./requests.js";

const later = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

describe("makeLoader: the useApiList race", () => {
  it("drops an older response that arrives after a newer one", async () => {
    const loader = makeLoader();
    const first = later(), second = later();
    const seen = [];
    const a = loader.run(() => first.promise, (v) => seen.push(v), () => seen.push("error"));
    const b = loader.run(() => second.promise, (v) => seen.push(v), () => seen.push("error"));
    second.resolve("new");  // the newer request answers first
    await b;
    first.resolve("old");   // the older one answers late
    await a;
    expect(seen).toEqual(["new"]);
  });
  it("drops an older failure that arrives after a newer success", async () => {
    const loader = makeLoader();
    const first = later(), second = later();
    const seen = [];
    const a = loader.run(() => first.promise, (v) => seen.push(v), (e) => seen.push(`error:${e.message}`));
    const b = loader.run(() => second.promise, (v) => seen.push(v), (e) => seen.push(`error:${e.message}`));
    second.resolve("new"); await b;
    first.reject(new Error("timeout")); await a;
    expect(seen).toEqual(["new"]);
  });
  it("reports the newest answer when answers arrive in order", async () => {
    const loader = makeLoader();
    const seen = [];
    await loader.run(async () => "one", (v) => seen.push(v), () => {});
    await loader.run(async () => "two", (v) => seen.push(v), () => {});
    expect(seen).toEqual(["one", "two"]);
  });
  it("cancel() drops what is in flight (the component went away, or the branch changed)", async () => {
    const loader = makeLoader();
    const p = later();
    const seen = [];
    const a = loader.run(() => p.promise, (v) => seen.push(v), () => seen.push("error"));
    loader.cancel();
    p.resolve("late"); await a;
    expect(seen).toEqual([]);
  });
  it("reports a failure of the newest request", async () => {
    const loader = makeLoader();
    const seen = [];
    await loader.run(async () => { throw new Error("nope"); }, (v) => seen.push(String(v)), (e) => seen.push(e.message));
    expect(seen).toEqual(["nope"]);
  });
});

describe("buildUrl", () => {
  it("adds sorted params and leaves out empty ones", () => {
    expect(buildUrl("/expenses", { status: "draft", month: "", category: undefined, a: null })).toBe("/expenses?status=draft");
    expect(buildUrl("/expenses", { month: "2026-11", status: "all" })).toBe("/expenses?month=2026-11&status=all");
  });
  it("gives the same address for the same params in any order (so no pointless reload)", () => {
    expect(buildUrl("/x", { b: 1, a: 2 })).toBe(buildUrl("/x", { a: 2, b: 1 }));
  });
  it("keeps an existing query and encodes values", () => {
    expect(buildUrl("/x?y=1", { q: "a b&c" })).toBe("/x?y=1&q=a%20b%26c");
    expect(buildUrl("/x")).toBe("/x");
  });
});

describe("splitResponse", () => {
  it("takes an array as the rows", () => { expect(splitResponse({ data: [{ id: 1 }], meta: { total: 1 } })).toEqual({ rows: [{ id: 1 }], meta: { total: 1 } }); });
  it("takes { rows, ...rest } as rows plus meta (today's /expenses)", () => {
    const r = splitResponse({ data: { rows: [{ id: 1 }], drafts: 2, canManage: true, categories: [] } });
    expect(r.rows).toEqual([{ id: 1 }]);
    expect(r.meta).toEqual({ drafts: 2, canManage: true, categories: [] });
  });
  it("gives no rows for a report-shaped answer, and survives nothing", () => {
    expect(splitResponse({ data: { total: 5 } })).toEqual({ rows: [], meta: { total: 5 } });
    expect(splitResponse(undefined)).toEqual({ rows: [], meta: {} });
  });
});

describe("invalidate", () => {
  it("does nothing when no list is on screen", () => { expect(() => invalidate(["/expenses"])).not.toThrow(); });
});
