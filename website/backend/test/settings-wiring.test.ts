import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { hashPassword } from "@sheetal/backend-core/lib/secrets";
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

  it("gives a new business the trial", async () => {
    const r = await post("/register", { user_name: "Ram Shrestha", email: "ram@example.com", password: "a-good-password", password_confirmation: "a-good-password" }, "10.3.0.1");
    expect(r.statusCode).toBeLessThan(300);
    const m = await app.db!.membership.findFirstOrThrow({ where: { user: { email: "ram@example.com" } }, include: { tenant: true } });
    expect(m.tenant).toMatchObject({ status: "trial", planId: "agency-business" });
    const days = (m.tenant.renewsAt!.getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });
});
