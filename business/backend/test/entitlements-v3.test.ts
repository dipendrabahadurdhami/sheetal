// Entitlements v3 through the business API (P3-BE-3): GET /entitlements in each billing mode; a business on "apps" is refused writes to an app
// it has no access to (nothing is written) and keeps writing on the free edition after a paid period lapses; "shadow" answers like "plans" and records the
// differences; another business's subscriptions never count. Businesses on "plans" (all of them today) behave exactly as before.
// Where it fits: runs with the business API tests (throwaway PostgreSQL): npm run test -w @sheetal/business-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
const appOf = (r: { json(): { data: { apps: { appId: string }[] } } }, id: string) => r.json().data.apps.find((a) => a.appId === id) as { access: string; edition: string | null; limits: Record<string, number | null> };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, expenses RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@ent-v3.test`, userName: `ev3-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "V3 Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.biz, name: "Head office" } })).id;
});
afterAll(async () => { await app.close(); });

describe("GET /entitlements", () => {
  it("on plans (every business today): today's answer, mode 'plans'", async () => {
    const r = await call("owner", "GET", "/entitlements");
    expect(r.statusCode).toBe(200);
    expect(r.json().data.mode).toBe("plans");
    expect(appOf(r, "hotel")).toMatchObject({ access: "full", edition: "default" });
    expect(appOf(r, "listings").access).toBe("none"); // a hotel on Business has no Listings, as today
  });

  it("on apps: answers from the subscriptions; another business's rows never count", async () => {
    const db = app.db!;
    await db.tenant.update({ where: { id: ids.biz }, data: { billingMode: "apps" } });
    await db.subscription.create({ data: { tenantId: ids.biz, appId: "hotel", editionId: "free", status: "active" } });
    await db.subscription.create({ data: { tenantId: ids.otherBiz, appId: "crm", editionId: "full", status: "active", periodMonths: 1, currentPeriodStart: day(-5), currentPeriodEnd: day(25), priceGrossPaisa: 30_000n } });
    const r = await call("owner", "GET", "/entitlements");
    expect(r.json().data.mode).toBe("apps");
    expect(appOf(r, "hotel")).toMatchObject({ access: "full", edition: "free", limits: { rooms: 5 } });
    expect(appOf(r, "crm").access).toBe("none");
    expect(appOf(r, "workspace").access).toBe("full");
    expect(r.json().data.seats.limit).toBe(2);
  });
});

describe("writes follow the subscription (apps mode)", () => {
  it("a lapsed paid app falls back to its free edition and still writes; an uninstalled one is refused and nothing is written; paying again lets writes through", async () => {
    const db = app.db!;
    // Expenses has a free edition, so a lapsed paid subscription falls back to it (limited) and still writes; a cancelled-and-ended
    // paid-only app would lock. Here: an Expenses subscription that is uninstalled -> not available at all.
    const s = await db.subscription.create({ data: { tenantId: ids.biz, appId: "expenses", editionId: "full", status: "active", periodMonths: 1, currentPeriodStart: day(-40), currentPeriodEnd: day(-30), priceGrossPaisa: 20_000n } });
    const body = { date: new Date().toISOString().slice(0, 10), category: "supplies", amount: 100, method: "cash", branchId: ids.head };
    const limited = await call("owner", "POST", "/expenses", body);
    expect(limited.statusCode).toBe(200); // fell back to the free edition: writes go on within free limits
    await db.subscription.update({ where: { id: s.id }, data: { uninstalledAt: day(-1) } });
    const before = await db.expense.count({ where: { tenantId: ids.biz } });
    const none = await call("owner", "POST", "/expenses", body);
    expect(none.statusCode).toBe(403); // the app check refuses first (the 402 read-only answer is covered by platform/test/entitlements-v3.test.ts)
    expect(await db.expense.count({ where: { tenantId: ids.biz } })).toBe(before);
    await db.subscription.update({ where: { id: s.id }, data: { uninstalledAt: null, currentPeriodStart: day(-1), currentPeriodEnd: day(29) } });
    expect((await call("owner", "POST", "/expenses", body)).statusCode).toBe(200);
  });
});

describe("shadow mode", () => {
  it("answers like plans and records what the subscriptions would change", async () => {
    const db = app.db!;
    await db.tenant.update({ where: { id: ids.biz }, data: { billingMode: "shadow" } });
    const r = await call("owner", "GET", "/entitlements");
    expect(r.json().data.mode).toBe("shadow");
    expect(appOf(r, "hotel")).toMatchObject({ access: "full", edition: "default" }); // v1's answer
    let row = null;
    for (let i = 0; i < 40 && !row; i++) {
      row = await db.auditLog.findFirst({ where: { tenantId: ids.biz, action: "billing.shadow_diff" } });
      if (!row) await new Promise((res) => setTimeout(res, 50));
    }
    expect(row?.target).toMatch(/less/); // the business has only some apps as subscriptions, so v3 gives less: the shadow log says so
    await db.tenant.update({ where: { id: ids.biz }, data: { billingMode: "plans" } });
  });
});
