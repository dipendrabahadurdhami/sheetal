import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { hashPassword } from "@sheetal/platform/auth/secrets";
import { buildApp } from "../src/app.js";

// Platform settings that reach sign-in and sign-up: max login attempts and trial days.
let app: FastifyInstance;
const post = (url: string, body: object, ip = "10.1.1.1") => app.inject({ method: "POST", url: `/v1${url}`, payload: body, remoteAddress: ip });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "website"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await db.user.create({ data: { email: "sita@example.com", userName: "Sita", passwordHash: await hashPassword("right-password"), emailVerifiedAt: new Date() } });
  await db.appSetting.create({ data: { key: "platform", value: { maxLoginAttempts: 3, trialDays: 14 } } });
});
afterAll(async () => { await app.close(); });

describe("platform settings in sign-in and sign-up", () => {
  it("locks an email after the set number of wrong passwords", async () => {
    for (let i = 0; i < 3; i++) expect((await post("/login", { email: "sita@example.com", password: "wrong" }, `10.2.0.${i}`)).statusCode).toBe(401);
    const r = await post("/login", { email: "sita@example.com", password: "right-password" }, "10.2.0.9");
    expect(r.statusCode).toBe(429);
    expect(r.json().message).toMatch(/Too many tries/);
  });

  it("starts a new business on the free apps instead of a plan trial", async () => {
    const r = await post("/register", { user_name: "Ram Shrestha", email: "ram@example.com", password: "a-good-password", password_confirmation: "a-good-password" }, "10.3.0.1");
    expect(r.statusCode).toBeLessThan(300);
    const m = await app.db!.membership.findFirstOrThrow({ where: { user: { email: "ram@example.com" } }, include: { tenant: true } });
    // A new business now starts on the free basics (each app has its own trial in the Marketplace), so the platform trial days no longer start a Business plan.
    expect(m.tenant).toMatchObject({ status: "active", planId: "agency-starter", billingMode: "apps", renewsAt: null });
  });
});
