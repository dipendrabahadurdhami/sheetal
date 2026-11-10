import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { OTA_DEFAULTS, askForChannel, pauseRequest, replyToRequest } from "@sheetal/backend-core/domain/ota-requests";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string | number> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) => app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
const tenant = () => ({ id: String(ids.tenant), name: "Lakeside Hotel", type: "hotel" });
const ask = (o: Partial<Parameters<typeof askForChannel>[1]> = {}) => askForChannel(app.db!, { tenant: tenant(), listingId: Number(ids.listing), channel: "booking", price: 15, who: "owner", ...o });
const listing = (code: string, kind: string, photos: number) => app.db!.listing.create({ data: { code, slug: code.toLowerCase(), purpose: "rent", category: "Hotel", title: `Room ${code}`, kind, tenantId: String(ids.tenant), status: "published", photos: { create: Array.from({ length: photos }, (_, i) => ({ file: `p${i}.jpg`, sort: i })) } } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, ota_requests, ota_accounts RESTART IDENTITY CASCADE`);
  await db.outboundEmail.deleteMany(); await db.notification.deleteMany(); await db.listing.deleteMany();
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, role] of [["boss", "super_admin"], ["ops", "operations"], ["finance", "finance"], ["owner", null]] as const) {
    const u = await db.user.create({ data: { email: `${k}@sheetal.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: String(ids.owner), name: "Lakeside Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.listing = (await listing("SP-9001", "stay_hotel", 9)).id;
  ids.few = (await listing("SP-9002", "stay_hotel", 3)).id;
  ids.sale = (await listing("SP-9003", "sell", 9)).id;
});
afterAll(async () => { await app.close(); });

describe("site settings and partner accounts", () => {
  it("start with the old sample values, for staff with tenant access", async () => {
    const r = (await call("ops", "GET", "/admin/ota/settings")).json().data;
    expect(r.settings).toEqual(OTA_DEFAULTS);
    expect(Object.values(r.accounts).every((a) => (a as { status: string }).status === "not_connected")).toBe(true);
    expect((await call("owner", "GET", "/admin/ota/settings")).statusCode).toBe(403);
  });

  it("change only for the super admin, with checks, and are audited", async () => {
    expect((await call("ops", "PUT", "/admin/ota/settings", { payoutDays: 3 })).statusCode).toBe(403);
    for (const bad of [{ payoutDays: -1 }, { minPhotos: 99 }, { sites: { booking: { commission: 80 } } }, { sites: { nowhere: { on: true } } }, { extra: 1 }]) expect((await call("boss", "PUT", "/admin/ota/settings", bad)).statusCode, JSON.stringify(bad)).toBe(422);
    expect((await call("boss", "PUT", "/admin/ota/settings", { sites: { booking: { commission: 12 } }, minPhotos: 6 })).statusCode).toBe(200);
    const s = (await call("boss", "GET", "/admin/ota/settings")).json().data.settings;
    expect(s.sites.booking.commission).toBe(12);
    expect(s.sites.airbnb).toEqual(OTA_DEFAULTS.sites.airbnb);
    const t = (await app.db!.auditLog.findMany({ where: { action: "ota.settings" } })).map((a) => a.target);
    expect(t).toContain("sites.booking.commission: 15 → 12");
    expect(t).toContain("minPhotos: 8 → 6");
    expect((await call("boss", "PUT", "/admin/ota/settings", { minPhotos: 6 })).json().message).toBe("Nothing changed.");
    await call("boss", "PUT", "/admin/ota/settings", { minPhotos: 8 });
  });

  it("connect a site", async () => {
    expect((await call("ops", "PUT", "/admin/ota/accounts/booking", { status: "connected" })).statusCode).toBe(403);
    expect((await call("boss", "PUT", "/admin/ota/accounts/nowhere", { status: "connected" })).statusCode).toBe(404);
    expect((await call("boss", "PUT", "/admin/ota/accounts/booking", { status: "connected", note: "Partner id 123" })).statusCode).toBe(200);
    await call("boss", "PUT", "/admin/ota/accounts/expedia", { status: "connected" });
    expect((await call("boss", "GET", "/admin/ota/settings")).json().data.accounts.booking).toEqual({ status: "connected", note: "Partner id 123" });
    expect((await app.db!.auditLog.findMany({ where: { action: "ota.account" } })).map((a) => a.target)).toContain("booking: not_connected → connected");
  });
});

describe("asking for a site", () => {
  it("refuses what isn't possible, in plain words", async () => {
    await expect(ask({ channel: "airbnb" })).rejects.toThrow(/isn't available yet/); // not connected
    await expect(ask({ channel: "expedia" })).rejects.toThrow(/isn't available yet/); // connected but switched off
    await expect(ask({ channel: "nowhere" })).rejects.toThrow(/Pick one/);
    await expect(ask({ listingId: Number(ids.few) })).rejects.toThrow(/at least 8 photos.*has 3/);
    await expect(ask({ listingId: Number(ids.sale) })).rejects.toThrow(/Only stays/);
    await expect(ask({ listingId: 999999 })).rejects.toThrow(/isn't in this business/);
    await expect(ask({ tenant: { ...tenant(), type: "agency" } })).rejects.toThrow(/business type/);
  });

  it("creates a request, tells the staff, and allows only one open request per listing and site", async () => {
    const r = await ask({ note: "Please use the lake photos first" });
    expect(r).toMatchObject({ status: "requested", channel: "booking", price: 15, seq: 1 });
    expect(Array.isArray(r.log) && r.log.length).toBe(1);
    const bell = await app.db!.notification.findMany({ where: { type: "ota" } });
    expect(bell.map((b) => b.userId).sort()).toEqual([String(ids.boss), String(ids.ops)].sort()); // staff with tenants.manage
    await expect(ask()).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("the channel team's queue", () => {
  it("lists requests with the business and listing, and filters them", async () => {
    const r = await call("ops", "GET", "/admin/ota/requests");
    expect(r.json().data).toEqual([expect.objectContaining({ ref: "OTA-0001", business: "Lakeside Hotel", listing: "Room SP-9001", code: "SP-9001", status: "requested" })]);
    expect(r.json().counts).toEqual({ requested: 1 });
    expect((await call("ops", "GET", "/admin/ota/requests?status=live")).json().data).toEqual([]);
    expect((await call("ops", "GET", "/admin/ota/requests?q=lakeside")).json().data).toHaveLength(1);
    expect((await call("finance", "GET", "/admin/ota/requests")).statusCode).toBe(200); // finance can view tenants
    expect((await call("owner", "GET", "/admin/ota/requests")).statusCode).toBe(403);
  });

  it("moves a request on, asks questions, and tells the business each time", async () => {
    const id = (await app.db!.otaRequest.findFirstOrThrow()).id;
    const put = (b: object, who = "ops") => call(who, "PUT", `/admin/ota/requests/${id}`, b);
    expect((await put({ status: "setting_up" }, "finance")).statusCode).toBe(403);
    expect((await put({ status: "requested" })).statusCode).toBe(422);
    expect((await put({ status: "needs_info" })).statusCode).toBe(400);
    expect((await put({ status: "rejected" })).statusCode).toBe(400);
    expect((await put({ status: "live", otaPropertyId: "123" })).statusCode).toBe(400);
    expect((await put({ status: "setting_up" })).statusCode).toBe(200);
    expect((await put({ status: "needs_info", ask: "Send the property licence" })).json().data).toMatchObject({ status: "needs_info", ask: "Send the property licence" });

    const mail = await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "owner@sheetal.test" }, orderBy: { createdAt: "desc" } });
    expect(mail.subject).toBe("Your listing on Booking.com: Needs your reply");
    expect(mail.text).toContain("Send the property licence");
    const bell = await app.db!.notification.findMany({ where: { userId: String(ids.owner), type: "ota" } });
    expect(bell.length).toBeGreaterThanOrEqual(2);

    // The business answers; the team carries on.
    await expect(replyToRequest(app.db!, { tenantId: "other", id, who: "owner", text: "x", files: [] })).rejects.toThrow(/isn't in this business/);
    expect((await replyToRequest(app.db!, { tenantId: String(ids.tenant), id, who: "owner", text: "Attached", files: ["licence.pdf"] })).status).toBe("setting_up");
    await expect(replyToRequest(app.db!, { tenantId: String(ids.tenant), id, who: "owner", text: "again", files: [] })).rejects.toThrow(/isn't waiting/);

    const live = await put({ status: "live", otaPropertyId: "BK-778899", url: "https://www.booking.com/hotel/np/lakeside.html", note: "Photos approved" });
    expect(live.json().data).toMatchObject({ status: "live", otaPropertyId: "BK-778899", url: "https://www.booking.com/hotel/np/lakeside.html" });
    const log = live.json().data.log.map((l: { what: string }) => l.what);
    expect(log[0]).toContain("Asked Sheetal to post on Booking.com");
    expect(log).toContain("Being set up");
    expect(log.some((l: string) => l.startsWith("Marked live (BK-778899)"))).toBe(true);
    const audit = (await app.db!.auditLog.findMany({ where: { action: "ota.status" } })).map((a) => a.target);
    expect(audit).toContain("OTA-0001: requested → setting_up");
    expect(audit).toContain("OTA-0001: setting_up → live");
  });

  it("serves a reply file only when the request's log names it", async () => {
    const id = (await app.db!.otaRequest.findFirstOrThrow()).id;
    expect((await call("ops", "GET", `/admin/ota/requests/${id}/files/passwd`)).statusCode).toBe(404);
    const named = await call("ops", "GET", `/admin/ota/requests/${id}/files/licence.pdf`); // named in the log, but not on disk in this test
    expect(named.statusCode).toBe(404);
    expect(named.body).toContain("gone");
  });

  it("lets the business stop selling, then ask again", async () => {
    const r = await app.db!.otaRequest.findFirstOrThrow();
    expect((await pauseRequest(app.db!, { tenantId: String(ids.tenant), id: r.id, who: "owner" })).status).toBe("paused");
    await expect(pauseRequest(app.db!, { tenantId: String(ids.tenant), id: r.id, who: "owner" })).rejects.toThrow(/already stopped/);
    expect((await ask()).seq).toBe(2);
  });
});
