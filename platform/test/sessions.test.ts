// Tests of the sign-in session code that moved to platform/src/auth/sessions.ts (P1-BE-4), on stand-in database and cache objects.
// Where it fits: backend-core/src/modules/auth/sessions.ts re-exports it and registers the sessionDays reader; the business and admin
// tests exercise the real thing through the APIs. This file pins what moved: how long a sign-in lasts (and the fallback), that the cache
// is used, and that a membership written only the old way comes out limited, never "every branch" (fail closed, P1-BE-3).
// Run with: npm run test -w @sheetal/platform
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/auth/secrets.js";
import { SESSION_DAYS, createSession, forgetSessionDays, revokeAllSessions, revokeSession, setSessionDaysReader, userForToken } from "../src/auth/sessions.js";

const DAY = 864e5;
const fakeApp = (over: { session?: object | null; user?: object | null; cached?: string | null } = {}) => {
  const created: { data: Record<string, unknown> }[] = [];
  const cache = new Map<string, string>();
  if (over.cached) cache.set("sess:cached", over.cached);
  const db = {
    session: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => { created.push(a); return {}; }),
      findUnique: vi.fn(async () => over.session ?? null),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => [{ tokenHash: "h1" }, { tokenHash: "h2" }]),
    },
    user: { update: vi.fn(async () => ({})), findUnique: vi.fn(async () => over.user ?? null) },
  };
  const del = vi.fn(async (k: string) => { cache.delete(k); });
  const app = { db, cache: { get: vi.fn(async (k: string) => cache.get(k) ?? null), set: vi.fn(async (k: string, v: string) => { cache.set(k, v); }), del } } as never;
  return { app, db, created, cache, del };
};
const request = { ip: "1.2.3.4", headers: { "user-agent": "UA" } } as never;

afterEach(() => { setSessionDaysReader(null); });

describe("how long a sign-in lasts", () => {
  it("defaults to 30 days without a reader, and uses the setting when one is registered", async () => {
    const a = fakeApp();
    const t0 = Date.now();
    const token = await createSession(a.app, "u1", request);
    const row = a.created[0]!.data;
    expect(row).toMatchObject({ userId: "u1", tokenHash: sha256(token), ip: "1.2.3.4", userAgent: "UA" });
    expect((row.expiresAt as Date).getTime() - t0).toBeGreaterThan((SESSION_DAYS - 1) * DAY);
    expect((row.expiresAt as Date).getTime() - t0).toBeLessThan((SESSION_DAYS + 1) * DAY);

    setSessionDaysReader(async () => 7);       // also forgets the one-minute cache
    const b = fakeApp();
    await createSession(b.app, "u1", request);
    expect((b.created[0]!.data.expiresAt as Date).getTime() - Date.now()).toBeLessThan(8 * DAY);
  });

  it("falls back to 30 days when the setting is zero, negative or cannot be read", async () => {
    for (const reader of [async () => 0, async () => -3, async () => { throw new Error("no table"); }]) {
      setSessionDaysReader(reader);
      const a = fakeApp();
      await createSession(a.app, "u1", request);
      expect((a.created[0]!.data.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    }
    forgetSessionDays();
  });

  it("reads the setting at most once a minute", async () => {
    const reader = vi.fn(async () => 5);
    setSessionDaysReader(reader);
    const a = fakeApp();
    await createSession(a.app, "u1", request);
    await createSession(a.app, "u1", request);
    expect(reader).toHaveBeenCalledTimes(1);
    forgetSessionDays();
    await createSession(a.app, "u1", request);
    expect(reader).toHaveBeenCalledTimes(2);
  });
});

describe("userForToken", () => {
  const userRow = (membership: object) => ({ id: "u1", status: "active", memberships: [membership] });
  const membership = (over: object) => ({ id: "m1", scopes: "all", allBranches: true, branches: [], role: { perms: ["leads.view"] }, tenant: { id: "t1", branches: [{ id: "b1", name: "Pokhara" }, { id: "b2", name: "Chitwan" }] }, ...over });
  const live = { id: "s1", userId: "u1", revokedAt: null, expiresAt: new Date(Date.now() + DAY), lastUsedAt: new Date() };

  it("refuses an unknown, revoked or expired token, and a user who is not active", async () => {
    expect(await userForToken(fakeApp().app, "nope")).toBeNull();
    expect(await userForToken(fakeApp({ session: { ...live, revokedAt: new Date() } }).app, "t")).toBeNull();
    expect(await userForToken(fakeApp({ session: { ...live, expiresAt: new Date(Date.now() - 1000) } }).app, "t")).toBeNull();
    expect(await userForToken(fakeApp({ session: live, user: { ...userRow(membership({})), status: "suspended" } }).app, "t")).toBeNull();
  });

  it("returns the person with their memberships and puts the session in the cache", async () => {
    const a = fakeApp({ session: live, user: userRow(membership({ role: { perms: ["*"] } })) });
    const found = await userForToken(a.app, "tok");
    expect(found!.hash).toBe(sha256("tok"));
    expect(found!.user.memberships).toHaveLength(1);
    expect(a.cache.get(`sess:${sha256("tok")}`)).toBe("u1");
    const again = await userForToken(a.app, "tok");        // the second call comes from the cache: no session lookup
    expect(again).not.toBeNull();
    expect(a.db.session.findUnique).toHaveBeenCalledTimes(1);
  });

  it("a membership written only the old way (names, flag left at all, no rows) comes out limited to the branches its names match", async () => {
    const a = fakeApp({ session: live, user: userRow(membership({ scopes: ["Pokhara", "Gone"], allBranches: true, branches: [] })) });
    const m = (await userForToken(a.app, "tok"))!.user.memberships[0]!;
    expect(m.allBranches).toBe(false);
    expect(m.branches.map((l) => l.branchId)).toEqual(["b1"]);   // "Gone" matches nothing: dropped, never widened
  });

  it("an owner stays on every branch, and a row written the new way is returned as it is", async () => {
    const owner = fakeApp({ session: live, user: userRow(membership({ role: { perms: ["*"] }, scopes: ["Pokhara"] })) });
    expect((await userForToken(owner.app, "tok"))!.user.memberships[0]!.allBranches).toBe(true);
    const limited = fakeApp({ session: live, user: userRow(membership({ allBranches: false, scopes: ["Chitwan"], branches: [{ branchId: "b2", branch: { name: "Chitwan" } }] })) });
    const m = (await userForToken(limited.app, "tok"))!.user.memberships[0]!;
    expect(m).toMatchObject({ allBranches: false });
    expect(m.branches.map((l) => l.branchId)).toEqual(["b2"]);
  });
});

describe("ending sessions", () => {
  it("revokeSession revokes the one session and forgets it in the cache", async () => {
    const a = fakeApp();
    a.cache.set("sess:h9", "u1");
    await revokeSession(a.app, "h9");
    expect(a.db.session.updateMany).toHaveBeenCalledWith({ where: { tokenHash: "h9", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(a.cache.has("sess:h9")).toBe(false);
  });
  it("revokeAllSessions keeps the current device when asked", async () => {
    const a = fakeApp();
    await revokeAllSessions(a.app, "u1", "h1");
    expect(a.db.session.updateMany).toHaveBeenCalledWith({ where: { tokenHash: { in: ["h2"] } }, data: { revokedAt: expect.any(Date) } });
    expect(a.del).toHaveBeenCalledTimes(1);
    expect(a.del).toHaveBeenCalledWith("sess:h2");
  });
});
