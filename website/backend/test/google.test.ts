import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";

const CLIENT = "123456-abc.apps.googleusercontent.com";
let app: FastifyInstance;
let on = true;
let claims: Record<string, unknown> = {};
let tokenStatus = 200;
let lastTokenBody = "";
let ipN = 0;
const ip = () => `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}`;

const idToken = (c: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(c)).toString("base64url")}.y`;
const fakeFetch = (async (_url: unknown, init?: { body?: string }) => {
  lastTokenBody = String(init?.body ?? "");
  return new Response(JSON.stringify(tokenStatus === 200 ? { id_token: idToken(claims) } : { error: "invalid_grant" }), { status: tokenStatus });
}) as unknown as typeof fetch;

beforeAll(async () => {
  app = await buildApp(
    loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetalproperty.com", API_URL: "https://api.sheetalproperty.com" }),
    { google: async () => (on ? { clientId: CLIENT, clientSecret: "shh" } : null), fetch: fakeFetch },
  );
  for (const p of PLANS) await app.db!.plan.upsert({ where: { id: p.id }, create: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort }, update: {} });
});
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  on = true; tokenStatus = 200; lastTokenBody = "";
  claims = { aud: CLIENT, iss: "https://accounts.google.com", email: "Sita@Example.com", email_verified: true, name: "Sita Rai" };
  await app.db!.$executeRawUnsafe(`TRUNCATE users, tenants, audit_logs RESTART IDENTITY CASCADE`);
});

/** Starts the sign-in and returns the state and cookie Google would hand back. */
async function start() {
  const res = await app.inject({ method: "GET", url: "/v1/auth/google/start", remoteAddress: ip() });
  const loc = String(res.headers.location);
  const state = new URL(loc).searchParams.get("state")!;
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  return { res, loc, state, cookie };
}
const callback = (qs: string, cookie?: string) => app.inject({ method: "GET", url: `/v1/auth/google/callback?${qs}`, remoteAddress: ip(), headers: cookie ? { cookie } : {} });

describe("Continue with Google", () => {
  it("sends the person to Google with a state, a PKCE challenge and the exact return address", async () => {
    const { res, loc } = await start();
    expect(res.statusCode).toBe(302);
    const u = new URL(loc);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe(CLIENT);
    expect(u.searchParams.get("redirect_uri")).toBe("https://api.sheetalproperty.com/v1/auth/google/callback");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(String(res.headers["set-cookie"])).toMatch(/HttpOnly/);
  });

  it("creates a verified account and workspace for a new Google address, and signs in", async () => {
    const { state, cookie } = await start();
    const res = await callback(`code=abc&state=${state}`, cookie);
    expect(res.statusCode).toBe(302);
    const loc = String(res.headers.location);
    expect(loc.startsWith("https://sheetalproperty.com/google-signin#token=")).toBe(true);
    expect(lastTokenBody).toContain("code_verifier=");
    expect(lastTokenBody).not.toContain("sitaleak");
    const user = await app.db!.user.findUnique({ where: { email: "sita@example.com" }, include: { memberships: true } });
    expect(user!.emailVerifiedAt).not.toBeNull();
    expect(user!.memberships.length).toBe(1);
    // The token really works.
    const me = await app.inject({ method: "GET", url: "/v1/user-info", remoteAddress: ip(), headers: { authorization: `Bearer ${decodeURIComponent(loc.split("#token=")[1]!)}` } });
    expect(me.statusCode).toBe(200);
  });

  it("signs in an existing account with the same email instead of making a second one", async () => {
    await app.db!.user.create({ data: { email: "sita@example.com", userName: "Sita", passwordHash: "x" } });
    const { state, cookie } = await start();
    const res = await callback(`code=abc&state=${state}`, cookie);
    expect(String(res.headers.location)).toContain("#token=");
    expect(await app.db!.user.count()).toBe(1);
  });

  it("refuses a state that was already used, or a missing or wrong cookie", async () => {
    const a = await start();
    expect(String((await callback(`code=abc&state=${a.state}`, "g_state=other")).headers.location)).toContain("#error=expired");
    const b = await start();
    expect(String((await callback(`code=abc&state=${b.state}`)).headers.location)).toContain("#error=expired");
    const c = await start();
    await callback(`code=abc&state=${c.state}`, c.cookie);
    expect(String((await callback(`code=abc&state=${c.state}`, c.cookie)).headers.location)).toContain("#error=expired");
  });

  it("refuses an unverified Google email, a wrong audience and a failed code exchange", async () => {
    claims.email_verified = false;
    let s = await start();
    expect(String((await callback(`code=abc&state=${s.state}`, s.cookie)).headers.location)).toContain("#error=unverified");
    claims.email_verified = true; claims.aud = "someone-else";
    s = await start();
    expect(String((await callback(`code=abc&state=${s.state}`, s.cookie)).headers.location)).toContain("#error=failed");
    claims.aud = CLIENT; tokenStatus = 400;
    s = await start();
    expect(String((await callback(`code=abc&state=${s.state}`, s.cookie)).headers.location)).toContain("#error=failed");
    expect(await app.db!.user.count()).toBe(0);
  });

  it("never signs in Sheetal staff or a suspended account this way", async () => {
    await app.db!.user.create({ data: { email: "sita@example.com", userName: "Sita", passwordHash: "x", platformRole: "super_admin" } });
    let s = await start();
    expect(String((await callback(`code=abc&state=${s.state}`, s.cookie)).headers.location)).toContain("#error=staff");
    await app.db!.user.update({ where: { email: "sita@example.com" }, data: { platformRole: null, status: "suspended" } });
    s = await start();
    expect(String((await callback(`code=abc&state=${s.state}`, s.cookie)).headers.location)).toContain("#error=suspended");
  });

  it("is off when the Super Admin has not switched it on, and /site says so", async () => {
    on = false;
    expect(String((await start()).res.headers.location)).toContain("#error=off");
    expect((await app.inject({ method: "GET", url: "/v1/site", remoteAddress: ip() })).json().data.googleSignIn).toBe(false);
    on = true;
    expect((await app.inject({ method: "GET", url: "/v1/site", remoteAddress: ip() })).json().data.googleSignIn).toBe(true);
  });

  it("treats the person cancelling at Google as a friendly error", async () => {
    expect(String((await callback("error=access_denied")).headers.location)).toContain("#error=cancelled");
  });
});
