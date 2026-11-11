// Tests for maker-checker approvals and staff support sessions on the business API (P1-REST Stage 1; ACCESS.md section 13 rows "Approvals" and "Impersonation").
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL from backend-core/test/setup-db.ts): npm run test -w @sheetal/business-api
// How it works: a real business API with an owner, an accountant and a support staff member. Approvals go through HTTP using Expenses' "confirm" action; a support
// session is written straight into the table and signed with the same key the admin API uses, then used as a Bearer token on the business API.
// Rules: rules are OFF until a business switches one on; the maker never decides their own request; a support session is read-only, can't decide approvals,
// is counted and audited with the business name, and ends once.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { signSupportToken } from "@sheetal/platform/auth/support-token";
import { endSupportSession } from "@sheetal/platform/support/sessions";
import { expirePending } from "@sheetal/platform/approvals/service";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-approvals-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });
const RULE = { action: "expenses.expense.confirm", enabled: true, approverPermission: "expenses.expense.confirm" };
const newDraft = async () => {
  await app.db!.$executeRawUnsafe(`TRUNCATE recurring_expenses CASCADE`);
  const r = (await call("owner", "POST", "/expenses/recurring", { category: "rent", amount: 40_000, dayOfMonth: 1, method: "bank", branchId: ids.head })).json().data;
  return app.db!.expense.findFirstOrThrow({ where: { recurringId: r.id } });
};

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media, SECRETS_KEY: "test-secrets-key" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, event_outbox, biz_invoices, doc_counters, expenses, recurring_expenses, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, platformRole] of [["owner", null], ["accountant", null], ["staff", "super_admin"]] as const) {
    const u = await db.user.create({ data: { email: `${k}@approvals.test`, userName: k, platformRole, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  const acc = await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "accountant" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.accountant!, roleId: acc.id, status: "active" } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("approvals", () => {
  it("with no rule, the action runs straight away (rules are OFF in Phase 1)", async () => {
    const d = await newDraft();
    expect((await call("accountant", "POST", `/expenses/${d.id}/confirm`, {})).statusCode).toBe(200);
  });

  it("only a person who may edit settings can save a rule", async () => {
    expect((await call("accountant", "PUT", "/approvals/rules", RULE)).statusCode).toBe(403);
    expect((await call("owner", "PUT", "/approvals/rules", RULE)).statusCode).toBe(200);
  });

  it("a held action answers 202, changes nothing, and the same record can't be asked twice", async () => {
    const d = await newDraft();
    const first = await call("accountant", "POST", `/expenses/${d.id}/confirm`, {});
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ code: "approval_requested" });
    expect((await app.db!.expense.findUniqueOrThrow({ where: { id: d.id } })).status).toBe(d.status);
    expect((await call("accountant", "POST", `/expenses/${d.id}/confirm`, {})).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("the maker can't decide their own request; another person can, and it then runs as the maker", async () => {
    const d = await newDraft();
    const id = (await call("accountant", "POST", `/expenses/${d.id}/confirm`, {})).json().data.approvalId as string;
    expect((await call("accountant", "POST", `/approvals/${id}/approve`, {})).statusCode).toBe(403);
    expect((await call("owner", "POST", `/approvals/${id}/approve`, {})).statusCode).toBe(200);
    expect((await call("owner", "POST", `/approvals/${id}/approve`, {})).statusCode).toBeGreaterThanOrEqual(400);   // decided once
    const row = await app.db!.approvalRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("executed");
    expect((await app.db!.expense.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("confirmed");
  });

  it("a rejected request is final, and a waiting request that passed its time is expired by the job", async () => {
    const d = await newDraft();
    const id = (await call("accountant", "POST", `/expenses/${d.id}/confirm`, {})).json().data.approvalId as string;
    expect((await call("owner", "POST", `/approvals/${id}/reject`, { note: "No." })).statusCode).toBe(200);
    expect((await call("owner", "POST", `/approvals/${id}/approve`, {})).statusCode).toBeGreaterThanOrEqual(400);

    const d2 = await newDraft();
    const id2 = (await call("accountant", "POST", `/expenses/${d2.id}/confirm`, {})).json().data.approvalId as string;
    const swept = await expirePending(app.db!, new Date(Date.now() + 1000 * 3600 * 24 * 30), app.log);
    expect(swept).toBeGreaterThanOrEqual(1);
    expect((await app.db!.approvalRequest.findUniqueOrThrow({ where: { id: id2 } })).status).toBe("expired");
  });
});

describe("support sessions", () => {
  const open = async (readOnly = true, minutes = 15) => {
    const s = await app.db!.impersonationSession.create({ data: { staffId: ids.staff!, tenantId: ids.agency!, reason: "Ticket SUP-0001 help", readOnly, expiresAt: new Date(Date.now() + minutes * 60_000), ip: "127.0.0.1" } });
    return { id: s.id, token: signSupportToken(app.config.SECRETS_KEY, s.id) };
  };
  const as = (token: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
    app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${token}`, "x-tenant-id": ids.agency! } });

  it("reads the business, is refused every change, and can't decide approvals", async () => {
    const s = await open();
    expect((await as(s.token, "GET", "/expenses")).statusCode).toBe(200);
    const w = await as(s.token, "POST", "/expenses", { date: "2026-10-10", category: "rent", amount: 1, method: "cash", branchId: ids.head });
    expect(w.statusCode).toBe(403);
    expect(w.json().code).toBe("impersonation_read_only");
    expect((await as(s.token, "POST", `/approvals/none/approve`, {})).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("counts the requests and shows the session at /support/session", async () => {
    const s = await open();
    await as(s.token, "GET", "/expenses");
    await as(s.token, "GET", "/expenses");
    const info = await as(s.token, "GET", "/support/session");
    expect(info.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));   // the count is written without waiting
    expect((await app.db!.impersonationSession.findUniqueOrThrow({ where: { id: s.id } })).requestCount).toBeGreaterThanOrEqual(3);
  });

  it("a write-mode session may change data, and every write leaves an audit row for the business", async () => {
    const s = await open(false);
    const w = await as(s.token, "POST", "/expenses", { date: "2026-10-11", category: "supplies", amount: 5, method: "cash", branchId: ids.head });
    expect(w.statusCode).toBe(200);
    const row = await app.db!.auditLog.findFirst({ where: { tenantId: ids.agency, action: "impersonation.write" } });
    expect(row?.actorId).toBe(ids.staff);
  });

  it("ending writes both audit rows with the business name, once, and the token stops working", async () => {
    const s = await open();
    expect(await endSupportSession(app.db! as never, { id: s.id, endedBy: ids.staff! })).toBe(true);
    expect(await endSupportSession(app.db! as never, { id: s.id, endedBy: ids.staff! })).toBe(false);
    const rows = await app.db!.auditLog.findMany({ where: { action: "impersonation.ended", meta: { path: ["sessionId"], equals: s.id } } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.target).toBe("Everest Realty");
    expect((await as(s.token, "GET", "/expenses")).statusCode).toBe(401);
  });

  it("an expired or tampered token is refused", async () => {
    const s = await open(true, -1);
    expect((await as(s.token, "GET", "/expenses")).statusCode).toBe(401);
    const live = await open();
    expect((await as(live.token.slice(0, -3) + "AAA", "GET", "/expenses")).statusCode).toBe(401);
  });
});

describe("meta.can flags", () => {
  it("the Expenses list carries them with ?flags=1 and the plain list shape is unchanged", async () => {
    const plain = (await call("owner", "GET", "/expenses")).json();
    expect(plain.meta?.can).toBeUndefined();
    const flagged = (await call("owner", "GET", "/expenses?flags=1")).json();
    expect(flagged.meta.can).toBeTypeOf("object");
  });
});
