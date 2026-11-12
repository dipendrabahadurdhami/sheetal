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
// Plans the tests move businesses to (any other plan of the same type).
const other = (type: string, not: string) => PLANS.find((x) => x.type === type && x.id !== not)!.id;
const HOTEL_OTHER = other("hotel", "hotel-business"), AGENCY_OTHER = other("agency", "agency-business");
const call = (who: string | null, method: "GET" | "PATCH", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: who ? { authorization: `Bearer ${tok[who]}` } : {} });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, audit_logs, invoices, payments, payouts, payout_items, listings, leads, banners, upgrade_requests RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, role] of [["super", "super_admin"], ["finance", "finance"], ["editor", "content_editor"], ["owner", null], ["owner2", null]] as const) {
    const u = await db.user.create({ data: { email: `${k}@sheetal.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  const hotel = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Hotel", type: "hotel", planId: "hotel-business" }));
  const agency = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner2!, name: "Everest Realty", type: "agency", planId: "agency-business" }));
  ids.hotel = hotel.id; ids.agency = agency.id;
  const old = new Date(Date.now() - 60 * 864e5);
  await db.tenant.update({ where: { id: hotel.id }, data: { status: "active", createdAt: old } });
  await db.tenant.update({ where: { id: agency.id }, data: { status: "past_due", verification: "pending" } });
  // A trial ending in three days.
  const trial = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Trial Homestay", type: "host", planId: PLANS.find((x) => x.type === "host")!.id }));
  await db.tenant.update({ where: { id: trial.id }, data: { status: "trial", renewsAt: new Date(Date.now() + 3 * 864e5) } });

  const invoice = await db.invoice.create({ data: { tenantId: hotel.id, planId: "hotel-business", months: 1, subtotal: 1500, vat: 195, total: 1695, status: "open", dueAt: new Date() } });
  await db.payment.create({ data: { invoiceId: invoice.id, tenantId: hotel.id, provider: "manual", amount: 1695, ref: "R-wait", status: "pending_review" } });
  await db.listing.create({ data: { code: "EV-1", slug: "ev-1", tenantId: agency.id, purpose: "sale", category: "House", title: "House", status: "pending" } });
  await db.listing.create({ data: { code: "EV-2", slug: "ev-2", tenantId: agency.id, purpose: "sale", category: "House", title: "House 2", status: "published" } });
  await db.lead.create({ data: { tenantId: null, kind: "requirement", name: "Buyer", message: "Looking" } });
  await db.lead.create({ data: { tenantId: null, kind: "requirement", name: "Buyer 2", message: "Looking", feeStatus: "pending", status: "contacted" } });
  await db.upgradeRequest.create({ data: { tenantId: hotel.id, userId: ids.owner!, planId: HOTEL_OTHER, months: 3 } });
});
afterAll(async () => { await app.close(); });

describe("admin dashboard", () => {
  it("is for Sheetal staff only", async () => {
    expect((await call(null, "GET", "/admin/dashboard")).statusCode).toBe(401);
    expect((await call("owner", "GET", "/admin/dashboard")).statusCode).toBe(403); // a business owner, not staff
    expect((await call("editor", "GET", "/admin/dashboard")).statusCode).toBe(403); // staff without dashboard.view
  });

  it("counts businesses, sign-ups, trials, past due and MRR", async () => {
    const d = (await call("super", "GET", "/admin/dashboard")).json().data;
    expect(d.businesses.total).toBe(3);
    expect(d.businesses.byStatus).toMatchObject({ active: 1, past_due: 1, trial: 1 });
    expect(d.businesses.byType).toEqual({ hotel: 1, agency: 1, host: 1 });
    expect(d.signups).toEqual({ last7: 2, last30: 2 }); // the hotel is 60 days old
    expect(d.trialsEnding).toBe(1);
    expect(d.pastDue).toBe(1);
    const hotelPlan = PLANS.find((p) => p.id === "hotel-business")!.price;
    expect(d.mrr).toEqual({ total: hotelPlan, payingBusinesses: 1 }); // only the active paid plan; past due isn't counted
  });

  it("counts the work waiting, each with a link", async () => {
    const d = (await call("super", "GET", "/admin/dashboard")).json().data;
    const q = Object.fromEntries(d.queue.map((x: { id: string; count: number }) => [x.id, x.count]));
    expect(q).toEqual({ transfers: 1, listings: 1, kyc: 1, banners: 0, upgrades: 1, leads: 1, fees: 1 });
    expect(d.queue.every((x: { to: string }) => x.to.startsWith("/admin/"))).toBe(true);
    expect(d.money).toMatchObject({ total: 0 });
  });

  it("leaves out what the staff role can't open", async () => {
    const d = (await call("finance", "GET", "/admin/dashboard")).json().data;
    const ids_ = d.queue.map((x: { id: string }) => x.id);
    expect(ids_).toEqual(expect.arrayContaining(["transfers", "banners", "upgrades"]));
    expect(ids_).not.toContain("listings"); // finance can't moderate
    expect(ids_).not.toContain("kyc");
    expect(d.money).toBeDefined();
  });
});

describe("upgrade requests", () => {
  it("lists waiting requests and tells the business when approved", async () => {
    const list = (await call("super", "GET", "/admin/upgrades")).json().data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ planId: HOTEL_OTHER, tenant: { name: "Lakeside Hotel" } });
    expect((await call("editor", "PATCH", `/admin/upgrades/${list[0].id}`, { status: "done" })).statusCode).toBe(403);
    const res = await call("super", "PATCH", `/admin/upgrades/${list[0].id}`, { status: "done" });
    expect(res.statusCode).toBe(200);
    expect((await app.db!.tenant.findUniqueOrThrow({ where: { id: ids.hotel! } })).planId).toBe(HOTEL_OTHER);
    const told = await app.db!.notification.findMany({ where: { userId: ids.owner!, tenantId: ids.hotel! } });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ type: "billing", link: "/business/billing" });
    expect(told[0]!.title).toContain("now on");
    expect((await call("super", "PATCH", `/admin/upgrades/${list[0].id}`, { status: "done" })).statusCode).toBe(404); // already handled
  });

  it("tells the business why a request was declined", async () => {
    const r = await app.db!.upgradeRequest.create({ data: { tenantId: ids.agency!, userId: ids.owner2!, planId: AGENCY_OTHER, months: 1 } });
    expect((await call("super", "PATCH", `/admin/upgrades/${r.id}`, { status: "declined", note: "No payment yet." })).statusCode).toBe(200);
    const told = await app.db!.notification.findMany({ where: { userId: ids.owner2!, tenantId: ids.agency! } });
    expect(told[0]).toMatchObject({ message: "No payment yet." });
    expect((await app.db!.upgradeRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("declined");
    expect((await call("super", "PATCH", `/admin/upgrades/${r.id}`, { status: "maybe" })).statusCode).toBe(422);
  });
});
