import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { applyPayment } from "@sheetal/backend-core/domain/billing";
import { addDays, today } from "@sheetal/backend-core/domain/promote";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const L: Record<string, number> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });
const pay = async (invoiceId: string) => {
  const db = app.db!;
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const p = await db.payment.create({ data: { invoiceId, tenantId: inv.tenantId, provider: "esewa", amount: inv.total, ref: `T${Math.random().toString(36).slice(2)}` } });
  await applyPayment(db, app.mailer, { paymentId: p.id, siteUrl: "https://sheetal.test" });
};

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, listings, leads, invoices, payments, boosts RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent"]) {
    const u = await db.user.create({ data: { email: `${k}@promo.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.branch = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency } })).id;
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } })).id, status: "active" } });
  const mk = async (code: string, over: object = {}) => (await db.listing.create({ data: { code, slug: code.toLowerCase(), tenantId: ids.agency, branchId: ids.branch, kind: "sell", purpose: "sale", category: "House", title: `Home ${code}`, status: "published", city: "Kathmandu", publishedAt: new Date(), ...over } })).id;
  L.a = await mk("ER-0001"); L.b = await mk("ER-0002"); L.c = await mk("ER-0003", { city: "Pokhara" });
  L.hotel = await mk("ER-0004", { kind: "stay_hotel", purpose: "rent", category: "Hotel" });
  L.draft = await mk("ER-0005", { status: "draft" });
  // Two home spots only, so "full" can be tested.
  await db.appSetting.create({ data: { key: "promote", value: { home: { price: 500, spots: 2, active: true }, search: { price: 300, spots: 10, active: true }, city: { price: 200, spots: 1, active: true }, lengths: [3, 7, 14, 30] } } });
});
afterAll(async () => { await app.close(); });

describe("Promote", () => {
  it("shows places, listings and the plan's free slots", async () => {
    const r = await call("owner", "GET", "/promote");
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.places.map((p: { id: string; price: number }) => [p.id, p.price])).toEqual([["home", 500], ["search", 300], ["city", 200]]);
    expect(d.listings.map((l: { code: string }) => l.code)).not.toContain("ER-0005");
    expect(d.featured).toEqual({ limit: 8, used: 0 });
    expect(d.canBuy).toBe(true);
  });

  it("quotes and checks what fits", async () => {
    const q = await call("owner", "GET", `/promote/quote?listingId=${L.a}&place=home&days=7`);
    expect(q.json().data).toMatchObject({ total: 3500, startOn: today(), endOn: addDays(today(), 6), moved: false });
    expect((await call("owner", "GET", `/promote/quote?listingId=${L.a}&place=home&days=5`)).statusCode).toBe(400);
    expect((await call("owner", "GET", `/promote/quote?listingId=${L.hotel}&place=search&days=7`)).statusCode).toBe(400);
    expect((await call("owner", "GET", `/promote/quote?listingId=${L.a}&place=moon&days=7`)).statusCode).toBe(422);
  });

  it("only people who manage billing buy; only listings on the website", async () => {
    expect((await call("agent", "POST", "/promote/boosts", { listingId: L.a, place: "home", days: 7 })).statusCode).toBe(403);
    expect((await call("owner", "POST", "/promote/boosts", { listingId: L.draft, place: "home", days: 7 })).statusCode).toBe(404);
  });

  it("makes a boost with its invoice, starts it when paid, and counts it on the invoice", async () => {
    const r = await call("owner", "POST", "/promote/boosts", { listingId: L.a, place: "home", days: 7 });
    expect(r.statusCode).toBe(200);
    const { invoiceId, total, id } = r.json().data;
    expect(total).toBe(3500);
    ids.boostA = id;
    const inv = await app.db!.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv).toMatchObject({ kind: "boost", total: 3500, vat: 403, status: "open" });
    expect((inv.addons as { name: string }[])[0]!.name).toContain("ER-0001");
    // The same listing can't take the same place twice.
    expect((await call("owner", "POST", "/promote/boosts", { listingId: L.a, place: "home", days: 3 })).statusCode).toBe(400);
    let b = (await call("owner", "GET", "/promote")).json().data.boosts.find((x: { id: string }) => x.id === id);
    expect(b.phase).toBe("awaiting");
    await pay(invoiceId);
    b = (await call("owner", "GET", "/promote")).json().data.boosts.find((x: { id: string }) => x.id === id);
    expect(b).toMatchObject({ phase: "live", daysLeft: 7 });
    expect(await app.db!.outboundEmail.count({ where: { text: { contains: "for your boost" } } })).toBe(1);
  });

  it("offers the next free day when a place is full", async () => {
    const r = await call("owner", "POST", "/promote/boosts", { listingId: L.b, place: "home", days: 7 });
    await pay(r.json().data.invoiceId);
    const q = (await call("owner", "GET", `/promote/quote?listingId=${L.c}&place=home&days=3`)).json().data;
    expect(q).toMatchObject({ startOn: addDays(today(), 7), moved: true });
    // City spots are per city: Pokhara is free even with Kathmandu taken.
    const k = await call("owner", "POST", "/promote/boosts", { listingId: L.a, place: "city", days: 3 });
    expect(k.statusCode).toBe(200);
    expect((await call("owner", "GET", `/promote/quote?listingId=${L.b}&place=city&days=3`)).json().data.moved).toBe(true);
    expect((await call("owner", "GET", `/promote/quote?listingId=${L.c}&place=city&days=3`)).json().data.moved).toBe(false);
    // Cancelling an unpaid boost frees its spot and its invoice.
    expect((await call("owner", "POST", `/promote/boosts/${k.json().data.id}/cancel`)).statusCode).toBe(200);
    expect((await app.db!.invoice.findUniqueOrThrow({ where: { id: k.json().data.invoiceId } })).status).toBe("void");
    expect((await call("owner", "GET", `/promote/quote?listingId=${L.b}&place=city&days=3`)).json().data.moved).toBe(false);
  });

  it("moves the days left to another listing, and stops without a refund", async () => {
    const bad = await call("owner", "POST", `/promote/boosts/${ids.boostA}/move`, { listingId: L.b });
    expect(bad.statusCode).toBe(400); // ER-0002 already has a home boost
    await app.db!.listing.update({ where: { id: L.a }, data: { status: "sold" } });
    let b = (await call("owner", "GET", "/promote")).json().data.boosts.find((x: { id: string }) => x.id === ids.boostA);
    expect(b.phase).toBe("listing_off");
    expect((await call("agent", "POST", `/promote/boosts/${ids.boostA}/move`, { listingId: L.c })).statusCode).toBe(200);
    b = (await call("owner", "GET", "/promote")).json().data.boosts.find((x: { id: string }) => x.id === ids.boostA);
    expect(b).toMatchObject({ code: "ER-0003", phase: "live", history: [expect.objectContaining({ code: "ER-0001" })] });
    expect((await call("owner", "POST", `/promote/boosts/${ids.boostA}/stop`)).statusCode).toBe(200);
    expect((await call("owner", "POST", `/promote/boosts/${ids.boostA}/stop`)).statusCode).toBe(400);
    expect((await app.db!.boost.findUniqueOrThrow({ where: { id: ids.boostA } })).status).toBe("stopped");
  });

  it("keeps free featured slots to the plan's number", async () => {
    await app.db!.tenant.update({ where: { id: ids.agency }, data: { planId: "agency-starter" } });
    const no = await call("owner", "PUT", `/promote/featured/${L.b}`, { on: true });
    expect(no.statusCode).toBe(400);
    expect(no.json().message).toMatch(/no free featured slots/);
    await app.db!.tenant.update({ where: { id: ids.agency }, data: { planId: "agency-business" } });
    expect((await call("owner", "PUT", `/promote/featured/${L.b}`, { on: true })).statusCode).toBe(200);
    expect((await call("owner", "GET", "/promote")).json().data.featured.used).toBe(1);
  });
});
