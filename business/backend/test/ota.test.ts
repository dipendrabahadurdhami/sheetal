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
const ids: Record<string, string | number> = {};
const call = (who: string, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": String(ids[`${who}Tenant`]) } });
const listing = (code: string, kind: string, photos: number, tenantId: string) => app.db!.listing.create({ data: { code, slug: code.toLowerCase(), purpose: "rent", category: "Hotel", title: `Room ${code}`, kind, tenantId, status: "published", photos: { create: Array.from({ length: photos }, (_, i) => ({ file: `p${i}.jpg`, sort: i })) } } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", API_URL: "https://api.sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, ota_requests, ota_accounts, ai_usage, notifications RESTART IDENTITY CASCADE`);
  await db.listing.deleteMany();
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other"]) {
    const u = await db.user.create({ data: { email: `${k}@sheetal.test`, userName: k, emailVerifiedAt: new Date() } });
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
    ids[`${k}Tenant`] = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: u.id, name: k === "owner" ? "Lakeside Inn" : "Other Hotel", type: "hotel", planId: "hotel-business" }))).id;
  }
  ids.listing = (await listing("SP-8001", "stay_hotel", 9, String(ids.ownerTenant))).id;
  ids.few = (await listing("SP-8002", "stay_hotel", 2, String(ids.ownerTenant))).id;
  await db.otaAccount.create({ data: { channel: "booking", status: "connected" } });
});
afterAll(async () => { await app.close(); });

describe("selling on other sites", () => {
  it("shows which sites are open to this business", async () => {
    const r = (await call("owner", "GET", "/ota/requests")).json();
    expect(r.data).toEqual([]);
    expect(r.meta).toMatchObject({ allowed: true, minPhotos: 8, payoutDays: 7 });
    const by = Object.fromEntries(r.meta.channels.map((c: { id: string; available: boolean }) => [c.id, c.available]));
    expect(by).toEqual({ booking: true, airbnb: false, agoda: false, expedia: false, trip: false, google: false }); // only Booking.com is connected
  });

  it("checks the request and says what is wrong in plain words", async () => {
    const ask = (b: object) => call("owner", "POST", "/ota/requests", b);
    expect((await ask({ listingId: ids.listing, channel: "airbnb", price: 10 })).json().message).toMatch(/isn't available yet/);
    expect((await ask({ listingId: ids.few, channel: "booking", price: 10 })).json().message).toMatch(/at least 8 photos.*has 2/);
    expect((await ask({ listingId: ids.listing, channel: "booking", price: 500 })).statusCode).toBe(422);
    expect((await ask({ listingId: ids.listing, channel: "booking", price: 10, extra: 1 })).statusCode).toBe(422);
    expect((await call("other", "POST", "/ota/requests", { listingId: ids.listing, channel: "booking", price: 10 })).json().message).toMatch(/isn't in this business/); // someone else's listing
  });

  it("sends a request, allows one at a time, and keeps it private to the business", async () => {
    const r = await call("owner", "POST", "/ota/requests", { listingId: ids.listing, channel: "booking", price: 15, note: "Lake photos first" });
    expect(r.statusCode).toBe(201);
    expect(r.json().data).toMatchObject({ ref: "OTA-0001", status: "requested", channel: "booking", price: 15, note: "Lake photos first", log: [expect.objectContaining({ who: "owner" })] });
    expect((await call("owner", "POST", "/ota/requests", { listingId: ids.listing, channel: "booking", price: 15 })).statusCode).toBe(409);
    const list = (await call("owner", "GET", "/ota/requests")).json().data;
    expect(list).toEqual([expect.objectContaining({ listing: "Room SP-8001", code: "SP-8001" })]);
    expect((await call("other", "GET", "/ota/requests")).json().data).toEqual([]);
    expect((await call("owner", "GET", `/ota/requests?listingId=${ids.few}`)).json().data).toEqual([]);
  });

  it("takes an answer only when the team asked a question, and lets the business stop", async () => {
    const row = await app.db!.otaRequest.findFirstOrThrow();
    expect((await call("owner", "POST", `/ota/requests/${row.id}/reply`, { text: "Here you go" })).json().message).toMatch(/isn't waiting/);
    await app.db!.otaRequest.update({ where: { id: row.id }, data: { status: "needs_info", ask: "Send the licence" } });
    expect((await call("owner", "POST", `/ota/requests/${row.id}/reply`, {})).statusCode).toBe(400); // nothing to send
    expect((await call("other", "POST", `/ota/requests/${row.id}/reply`, { text: "hi" })).statusCode).toBe(404); // not theirs
    const ok = await call("owner", "POST", `/ota/requests/${row.id}/reply`, { text: "Licence number 123" });
    expect(ok.json().data.status).toBe("setting_up");
    expect(ok.json().data.log.at(-1).what).toBe("Replied: Licence number 123");
    expect((await call("other", "POST", `/ota/requests/${row.id}/pause`)).statusCode).toBe(404);
    expect((await call("owner", "POST", `/ota/requests/${row.id}/pause`)).json().data.status).toBe("paused");
    expect((await call("owner", "POST", `/ota/requests/${row.id}/pause`)).statusCode).toBe(400);
  });
});

describe("AI tools by plan", () => {
  it("refuses the lead finder when the plan doesn't include it", async () => {
    await app.db!.appSetting.create({ data: { key: "ai.features", value: { plans: { Business: { features: { lead_finder: false } } } } } });
    const r = await call("owner", "POST", "/ai/extract-leads", { text: "Looking for a flat in Lalitpur, call Ram 9841234567 please." });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toBe("Lead finder isn't part of the Business plan. Upgrade to use it.");
  });
});
