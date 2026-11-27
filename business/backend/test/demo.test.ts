// Tests for "Try the demo" on the business API (stage 1.2; FRONTEND-KIT.md section 8).
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL from platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// How it works: a real business API. A visitor starts a demo over HTTP, uses the token on the kit pages, and is refused everywhere that reaches outside.
// The cleanup is called with a clock one day ahead. A normal business next to the demo proves isolation and that cleanup never touches real data.
// Rules: a demo is fenced by an allow-list; its sample rows are its own; cleanup deletes only demo businesses whose time is up, and only demo users.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { DEMO_EMAIL_DOMAIN } from "@sheetal/platform/demo/guard";
import { buildApp } from "../src/app.js";
import { platformJobs } from "../src/jobs.js";
import { cleanupDemos } from "../src/modules/demo/service.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-demo-"));
let demo: { token: string; tenantId: string; expiresAt: string };
let realToken = "";
let realTenant = "";
const as = (token: string, tenantId: string) => (method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media, SECRETS_KEY: "test-secrets-key-for-the-demo-business-01", DEMO_SELF_SERVE: "true" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, event_outbox, expenses, recurring_expenses, reviews RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const u = await db.user.create({ data: { email: "owner@real.test", userName: "Real owner", emailVerifiedAt: new Date() } });
  realToken = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  realTenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: u.id, name: "Real Realty", type: "agency", planId: "agency-business" }))).id;
  const head = await db.branch.findFirstOrThrow({ where: { tenantId: realTenant } });
  await db.expense.create({ data: { tenantId: realTenant, branchId: head.id, spentOn: new Date(), category: "rent", amount: 1000, amountPaisa: BigInt(100000) } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("try the demo", () => {
  it("refuses an unknown business type and extra fields", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/demo/session", payload: { type: "bank" } })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ method: "POST", url: "/v1/demo/session", payload: { type: "agency", planId: "agency-pro" } })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("makes a throw-away business with sample rows and signs the visitor in as its owner", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/demo/session", payload: { type: "agency" } });
    expect(res.statusCode).toBeLessThan(300);
    demo = res.json().data;
    expect(demo.token.length).toBeGreaterThan(20);
    const t = await app.db!.tenant.findUniqueOrThrow({ where: { id: demo.tenantId } });
    expect(t.demo).toBe(true);
    expect(t.renewsAt).toBeNull();                                   // the billing run only takes businesses with a renewal date
    expect(t.demoExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    const ws = (await as(demo.token, demo.tenantId)("GET", "/workspaces")).json().data;
    expect(ws.user.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
    expect(ws.workspaces).toHaveLength(1);
    expect(ws.workspaces[0].role.perms).toContain("*");
    expect(await app.db!.expense.count({ where: { tenantId: demo.tenantId } })).toBe(5);
    expect(await app.db!.review.count({ where: { tenantId: demo.tenantId } })).toBe(3);
  });

  it("lets the visitor use the kit pages: read and add expenses, reply to a review", async () => {
    const call = as(demo.token, demo.tenantId);
    const list = await call("GET", "/expenses");
    expect(list.statusCode).toBe(200);
    const head = await app.db!.branch.findFirstOrThrow({ where: { tenantId: demo.tenantId } });
    const add = await call("POST", "/expenses", { category: "utilities", amount: 500, date: new Date().toISOString().slice(0, 10), method: "cash", branchId: head.id });
    expect(add.statusCode).toBeLessThan(300);
    expect((await call("GET", "/reviews")).statusCode).toBe(200);
  });

  it("refuses everything that reaches outside the demo with 403 demo_only", async () => {
    const call = as(demo.token, demo.tenantId);
    for (const [method, url, body] of [
      ["POST", "/team/invites", { invites: [{ email: "someone@example.com", roleId: "x" }] }],
      ["POST", "/workspaces", { name: "Second business", type: "agency" }],
      ["PUT", "/workspace/branding", { colors: ["#112233"] }],
      ["POST", "/team/roles", { name: "Helpers", perms: [] }],
      ["PUT", "/approvals/rules", { action: "expenses.expense.confirm", enabled: true }],
    ] as const) {
      const res = await call(method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().code, `${method} ${url}`).toBe("demo_only");
    }
    expect(await app.db!.invite.count()).toBe(0);
    expect(await app.db!.outboundEmail.count()).toBe(0);
  });

  it("is isolated: the demo cannot open a real business, and a real user is not fenced", async () => {
    expect([403, 404]).toContain((await as(demo.token, realTenant)("GET", "/expenses")).statusCode);
    expect([403, 404]).toContain((await as(realToken, demo.tenantId)("GET", "/expenses")).statusCode);
    const mine = await as(realToken, realTenant)("POST", "/team/roles", { name: "Helpers", perms: [] });
    expect(mine.statusCode).toBe(200);
  });

  it("has an hourly cleanup job", () => {
    const job = platformJobs(app).find((j) => j.id === "demo.cleanup");
    expect(job?.everyMs).toBe(3_600_000);
  });

  it("cleanup leaves a demo that still has time, then deletes it with its rows and users, and never touches a real business", async () => {
    const db = app.db!;
    expect(await cleanupDemos(db, new Date())).toBe(0);
    expect(await db.tenant.count({ where: { id: demo.tenantId } })).toBe(1);

    expect(await cleanupDemos(db, new Date(Date.now() + 25 * 3_600_000))).toBe(1);
    expect(await db.tenant.count({ where: { id: demo.tenantId } })).toBe(0);
    expect(await db.expense.count({ where: { tenantId: demo.tenantId } })).toBe(0);
    expect(await db.review.count({ where: { tenantId: demo.tenantId } })).toBe(0);
    expect(await db.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } })).toBe(0);
    expect((await as(demo.token, demo.tenantId)("GET", "/workspaces")).statusCode).toBe(401);

    expect(await db.tenant.count({ where: { id: realTenant } })).toBe(1);
    expect(await db.expense.count({ where: { tenantId: realTenant } })).toBe(1);
    expect(await db.user.count({ where: { email: "owner@real.test" } })).toBe(1);
    expect(await cleanupDemos(db, new Date(Date.now() + 25 * 3_600_000))).toBe(0);   // a second run finds nothing
  });
});
