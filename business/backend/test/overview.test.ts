import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { addDays } from "@sheetal/backend-core/domain/promote";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, url = "/overview", branch?: string, tenant = ids.agency!) =>
  app.inject({ method: "GET", url: `/v1${url}`, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant, ...(branch ? { "x-branch": branch } : {}) } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, biz_invoices, doc_counters, expenses, recurring_expenses, payouts, payout_items, listings, leads, rent_bills, rent_leases, rent_units, rent_owners, boosts, banners RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "accountant", "agent", "pokhara", "hotelier"]) {
    const u = await db.user.create({ data: { email: `${k}@everest.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.hotelier!, name: "Lakeside Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  ids.pokhara_branch = (await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.accountant!, roleId: (await role("accountant")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.pokhara!, roleId: (await role("branch_manager")).id, status: "active", scopes: ["Pokhara"] } });

  const listing = (n: number, status: "published" | "pending" | "draft", branchId: string) => db.listing.create({ data: { code: `EV-${n}`, slug: `ev-${n}`, tenantId: ids.agency!, branchId, purpose: "sale", category: "House", title: `House ${n}`, status } });
  await listing(1, "published", ids.head!); await listing(2, "published", ids.head!); await listing(3, "pending", ids.head!); await listing(4, "draft", ids.pokhara_branch!); await listing(5, "published", ids.pokhara_branch!);

  const lead = (name: string, branchId: string, extra: object = {}) => db.lead.create({ data: { tenantId: ids.agency!, branchId, kind: "contact_agent", name, message: "Hi", ...extra } });
  await lead("New and unread", ids.head!);
  await lead("Mine", ids.head!, { assigneeId: ids.agent!, followAt: new Date(Date.now() - 3600e3) });
  await lead("Someone else's", ids.head!, { assigneeId: ids.accountant! });
  await lead("Pokhara lead", ids.pokhara_branch!);
  await lead("Won already", ids.head!, { status: "won" });

  const today = nepalDay();
  const inv = (no: string, total: number, dueOn: string, paid: number) => db.bizInvoice.create({ data: { tenantId: ids.agency!, branchId: ids.head!, kind: "invoice", no, status: "sent", toName: "Buyer", issuedOn: dayOf(today), dueOn: dayOf(dueOn), lines: [], subtotal: total, vat: 0, total, receipts: paid ? { create: { tenantId: ids.agency!, no: `RC-${no}`, amount: paid, method: "cash", paidOn: dayOf(today) } } : undefined } });
  await inv("INV-1", 10_000, addDays(today, 10), 10_000); // paid
  await inv("INV-2", 20_000, addDays(today, -3), 5_000); // overdue by 15,000
  await inv("INV-3", 8_000, addDays(today, 10), 0); // open, not due
  await db.expense.create({ data: { tenantId: ids.agency!, branchId: ids.head!, status: "confirmed", spentOn: dayOf(today), category: "rent", amount: 4_000 } });
  await db.expense.create({ data: { tenantId: ids.agency!, branchId: ids.head!, status: "draft", spentOn: dayOf(today), category: "rent", amount: 9_999 } });
  await db.payout.create({ data: { tenantId: ids.agency!, branchId: ids.head!, status: "pending", gross: 3_000, fee: 0, net: 3_000, scheduledOn: dayOf(addDays(today, 3)) } });
});
afterAll(async () => { await app.close(); });

describe("business overview: who sees what", () => {
  it("needs a signed-in member of the business", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/overview", headers: { "x-tenant-id": ids.agency! } })).statusCode).toBe(401);
    expect((await call("hotelier")).statusCode).toBe(403); // not a member of the agency
  });

  it("gives the owner every block", async () => {
    const d = (await call("owner")).json().data;
    expect(d.listings).toMatchObject({ published: 3, pending: 1, drafts: 1 });
    expect(d.money.invoices).toMatchObject({ sent: 3, paid: 1, overdue: 1, overdueTotal: 15_000 });
    expect(d.money.expenses).toMatchObject({ total: 4_000, count: 1 }); // the draft doesn't count
    expect(d.money.payouts).toMatchObject({ pending: 3_000, pendingCount: 1 });
    expect(d.rent).toBeDefined();
    expect(d.plan.name).toBeTruthy();
    expect(d.attention.map((a: { id: string }) => a.id)).toContain("overdue");
    expect(d.attention.every((a: { to: string }) => a.to.startsWith("/business"))).toBe(true);
  });

  it("hides money from an agent and shows only their leads", async () => {
    const d = (await call("agent")).json().data;
    expect(d.money).toBeUndefined();
    expect(d.rent).toBeUndefined();
    expect(d.listings).toBeDefined();
    // The agent sees their own and unassigned leads: 4 of the 5 (not the one given to the accountant).
    expect(d.leads.newThisWeek).toBe(4);
    expect(d.leads.followUpsDue).toBe(1);
    expect(d.attention.map((a: { id: string }) => a.id)).not.toContain("overdue");
  });

  it("gives the accountant money but not listings or leads", async () => {
    const d = (await call("accountant")).json().data;
    expect(d.money.invoices).toBeDefined();
    expect(d.money.expenses).toBeDefined();
    expect(d.listings).toBeUndefined();
    expect(d.leads).toBeUndefined();
  });

  it("keeps a branch-limited person inside their branch", async () => {
    const d = (await call("pokhara")).json().data;
    expect(d.listings).toMatchObject({ published: 1, pending: 0, drafts: 1 });
    expect(d.leads.newThisWeek).toBe(1);
    expect(d.money.invoices).toBeUndefined(); // a branch manager can't see invoices...
    expect(d.money.expenses).toMatchObject({ total: 0 }); // ...but sees expenses, and only Pokhara's
    expect((await call("pokhara", "/overview", ids.head)).statusCode).toBe(403); // not their branch
  });

  it("follows the branch the owner picks", async () => {
    const d = (await call("owner", "/overview", ids.pokhara_branch)).json().data;
    expect(d.listings).toMatchObject({ published: 1, drafts: 1 });
    expect(d.money.invoices).toMatchObject({ sent: 0, overdue: 0 });
  });

  it("shows hotel stays only to a business that has them", async () => {
    const d = (await call("hotelier", "/overview", undefined, ids.hotel)).json().data;
    expect(d.today.stays).toMatchObject({ arrivals: 0, departures: 0, inHouse: 0 });
    expect(d.rent).toBeUndefined();
    expect((await call("owner")).json().data.today?.stays).toBeUndefined();
  });
});
