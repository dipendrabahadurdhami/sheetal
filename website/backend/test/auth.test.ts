import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { hashPassword } from "@sheetal/backend-core/lib/secrets";

let app: FastifyInstance;
let ipN = 0;
// A different client address per call group, so route rate limits don't interfere between tests.
const ip = () => `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`;

const call = (method: "GET" | "POST", url: string, body?: object, token?: string, remoteAddress = ip()) =>
  app.inject({ method, url: `/v1${url}`, payload: body, remoteAddress, headers: token ? { authorization: `Bearer ${token}` } : {} });

const lastEmail = async (to: string) => (await app.db!.outboundEmail.findFirst({ where: { to }, orderBy: { createdAt: "desc" } }))!;
const linkToken = (text: string) => (text.match(/(?:token=|reset-password\/)([A-Za-z0-9_-]{20,})/) ?? [])[1]!;

const register = (email = "ram@example.com", password = "secret-pass-1") =>
  call("POST", "/register", { user_name: "Ram Shrestha", email, password, password_confirmation: password, user_type: "Owner" });
const login = async (email = "ram@example.com", password = "secret-pass-1") => (await call("POST", "/login", { email, password })).json().data?.token as string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetalproperty.com" }));
  for (const p of PLANS) await app.db!.plan.upsert({ where: { id: p.id }, create: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort }, update: {} });
});
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  await app.db!.$executeRawUnsafe(`TRUNCATE users, tenants, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  await (app.cache as { close(): Promise<void> }).close(); // clear cached sessions and lockouts
});

describe("sign up", () => {
  it("creates the account, a Starter workspace and sends a confirmation email", async () => {
    const res = await register();
    expect(res.statusCode).toBe(200);
    const user = await app.db!.user.findUnique({ where: { email: "ram@example.com" }, include: { memberships: { include: { tenant: true, role: true } } } });
    expect(user!.passwordHash).not.toContain("secret-pass-1");
    expect(user!.memberships[0]!.tenant.planId).toBe("agency-starter");
    expect(user!.memberships[0]!.role.key).toBe("owner");
    expect((await lastEmail("ram@example.com")).subject).toBe("Confirm your email");
  });

  it("refuses a second account with the same email (any letter case)", async () => {
    await register();
    const res = await register("RAM@Example.com");
    expect(res.statusCode).toBe(409);
  });

  it("checks fields and lists problems per field", async () => {
    const res = await call("POST", "/register", { user_name: "R", email: "bad", password: "short", password_confirmation: "other" });
    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().errors)).toEqual(expect.arrayContaining(["user_name", "email", "password"]));
  });
});

describe("log in", () => {
  it("returns a token that opens the account", async () => {
    await register();
    const token = await login();
    const me = await call("GET", "/user-info", undefined, token);
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({ email: "ram@example.com", plan: "Starter", email_verified: false });
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await register();
    const a = await call("POST", "/login", { email: "ram@example.com", password: "wrong-password" });
    const b = await call("POST", "/login", { email: "nobody@example.com", password: "wrong-password" });
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]);
    expect(a.json().message).toBe(b.json().message);
  });

  it("pauses an email after 5 wrong passwords, even with the right one", async () => {
    await register();
    for (let i = 0; i < 5; i++) await call("POST", "/login", { email: "ram@example.com", password: "wrong-password" });
    const res = await call("POST", "/login", { email: "ram@example.com", password: "secret-pass-1" });
    expect(res.statusCode).toBe(429);
  });

  it("asks imported old-site users to set a new password by email", async () => {
    await app.db!.user.create({ data: { email: "old@example.com", userName: "Old User", legacyId: 42 } });
    const res = await call("POST", "/login", { email: "old@example.com", password: "anything-old" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("password_reset_required");
    expect((await lastEmail("old@example.com")).subject).toBe("Welcome to the new Sheetal Property");
  });

  it("rejects missing and fake tokens", async () => {
    expect((await call("GET", "/user-info")).statusCode).toBe(401);
    expect((await call("GET", "/user-info", undefined, "not-a-real-token")).statusCode).toBe(401);
  });
});

describe("email links", () => {
  it("confirming the email logs the person in, and the link works once", async () => {
    await register();
    const t = linkToken((await lastEmail("ram@example.com")).text);
    const first = await call("GET", `/email/verify/${t}`);
    expect(first.statusCode).toBe(200);
    expect((await call("GET", "/user-info", undefined, first.json().token)).json().data.email_verified).toBe(true);
    expect((await call("GET", `/email/verify/${t}`)).statusCode).toBe(400);
  });

  it("forgot password: same answer for unknown emails; the reset logs out every device", async () => {
    await register();
    const oldToken = await login();
    const unknown = await call("POST", "/forgot-password", { email: "nobody@example.com" });
    const known = await call("POST", "/forgot-password", { email: "ram@example.com" });
    expect(unknown.json().message).toBe(known.json().message);

    const t = linkToken((await lastEmail("ram@example.com")).text);
    const reset = await call("POST", "/reset-password", { token: t, email: "ram@example.com", password: "brand-new-pass", password_confirmation: "brand-new-pass" });
    expect(reset.statusCode).toBe(200);
    expect((await call("GET", "/user-info", undefined, oldToken)).statusCode).toBe(401);
    expect(await login("ram@example.com", "brand-new-pass")).toBeTruthy();
  });
});

describe("account", () => {
  it("changes the password and logs out other devices only", async () => {
    await register();
    const here = await login();
    const elsewhere = await login();
    const wrong = await call("POST", "/change-password", { current_password: "nope", new_password: "another-pass-9" }, here);
    expect(wrong.statusCode).toBe(422);
    const ok = await call("POST", "/change-password", { current_password: "secret-pass-1", new_password: "another-pass-9", new_password_confirmation: "another-pass-9" }, here);
    expect(ok.statusCode).toBe(200);
    expect((await call("GET", "/user-info", undefined, here)).statusCode).toBe(200);
    expect((await call("GET", "/user-info", undefined, elsewhere)).statusCode).toBe(401);
  });

  it("updates the profile", async () => {
    await register();
    const token = await login();
    const res = await call("POST", "/update-profile", { first_name: "Ram", last_name: "Shrestha", phone: "9841000000" }, token);
    expect(res.json().data).toMatchObject({ first_name: "Ram", phone: "9841000000" });
  });

  it("logs out", async () => {
    await register();
    const token = await login();
    expect((await call("POST", "/logout", undefined, token)).statusCode).toBe(200);
    expect((await call("GET", "/user-info", undefined, token)).statusCode).toBe(401);
  });

  it("suspended accounts can't log in", async () => {
    await app.db!.user.create({ data: { email: "s@example.com", userName: "S", passwordHash: await hashPassword("secret-pass-1"), status: "suspended" } });
    const res = await call("POST", "/login", { email: "s@example.com", password: "secret-pass-1" });
    expect(res.statusCode).toBe(403);
  });
});
