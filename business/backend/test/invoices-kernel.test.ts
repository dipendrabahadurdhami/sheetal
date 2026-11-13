// Tests for customer invoices on the kernel (P2-W3): what the move to apps/invoicing/backend added. invoices.test.ts (the old tests) is NOT repeated here and
// passes unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers the kernel columns, a draft save on an old version (409), the events written with each change, isolation, and that the Invoicing app's
// booking code is the Hotel app's.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { bookingCode } from "@sheetal/app-invoicing/backend";
import { bookingCode as hotelCode } from "../src/modules/hotel/routes.js";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body: object | undefined, tenant: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant } });
const events = (name: string) => app.db!.eventOutbox.findMany({ where: { tenantId: ids.biz, name } });
const draft = (over: object = {}) => ({ to: "Ram Traders", date: "2026-11-01", due: "2026-11-11", vatPct: 13, lines: [{ what: "Consulting", qty: 1, rate: 10_000 }], ...over });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, biz_invoices, biz_receipts, doc_counters, audit_logs, event_outbox RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-inv.test`, userName: `ki-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
});
afterAll(async () => { await app.close(); });

describe("Customer invoices on the kernel", () => {
  it("uses the Hotel app's booking code", () => {
    expect(bookingCode({ seq: 7 })).toBe(hotelCode({ seq: 7 }));
  });

  it("writes the kernel columns and an event, and refuses a draft save on an old version", async () => {
    const d = (await call("owner", "POST", "/invoices", draft(), ids.biz!)).json().data;
    expect(d.version).toBe(1);
    expect(await app.db!.bizInvoice.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ createdBy: ids.owner, updatedBy: ids.owner, deletedAt: null });
    expect(await events("invoicing.invoice.drafted")).toHaveLength(1);
    const ok = await call("owner", "PUT", `/invoices/${d.id}`, draft({ to: "Ram Traders Pvt", version: 1 }), ids.biz!);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.version).toBe(2);
    expect((await call("owner", "PUT", `/invoices/${d.id}`, draft({ to: "Stale", version: 1 }), ids.biz!)).statusCode).toBe(409);
    ids.inv = d.id;
  });

  it("writes an event with sending and with each payment, in the same step as the change", async () => {
    const sent = (await call("owner", "POST", `/invoices/${ids.inv}/send`, undefined, ids.biz!)).json().data;
    expect(sent.no).toMatch(/^INV-/);
    expect((await events("invoicing.invoice.sent")).map((e) => (e.payload as { no: string }).no)).toEqual([sent.no]);
    const paid = await call("owner", "POST", `/invoices/${ids.inv}/receipts`, { amount: 5_000, method: "bank", at: "2026-11-02" }, ids.biz!);
    expect(paid.statusCode).toBe(200);
    expect(await events("invoicing.invoice.paid")).toHaveLength(1);
    expect(await app.db!.auditLog.count({ where: { tenantId: ids.biz, action: "invoice.paid" } })).toBe(1);
  });

  it("never shows or changes another business's invoices", async () => {
    expect((await call("other", "POST", `/invoices/${ids.inv}/receipts`, { amount: 1, method: "cash", at: "2026-11-03" }, ids.otherBiz!)).statusCode).toBe(404);
    expect((await call("other", "GET", "/invoices", undefined, ids.otherBiz!)).json().data).toEqual([]);
  });
});
