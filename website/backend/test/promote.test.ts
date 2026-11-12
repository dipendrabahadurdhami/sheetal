import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { addDays, today } from "@sheetal/backend-core/domain/promote";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const L: Record<string, number> = {};
const get = (url: string) => app.inject({ method: "GET", url: `/v1${url}` });
// Real browsers always send Accept-Language; isBotRequest() counts a request without it as a bot.
const post = (url: string, body: object, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/120", lang = "en-US,en;q=0.9") => app.inject({ method: "POST", url: `/v1${url}`, payload: body, headers: { "user-agent": ua, ...(lang ? { "accept-language": lang } : {}) } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "website"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, listings, boosts RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const owner = await db.user.create({ data: { email: "o@promo.test", userName: "o", emailVerifiedAt: new Date() } });
  const t = await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Everest Realty", type: "agency", planId: "agency-business" }));
  const mk = async (code: string, days: number, over: object = {}) => (await db.listing.create({ data: { code, slug: code.toLowerCase(), tenantId: t.id, kind: "sell", purpose: "sale", category: "House", title: code, status: "published", city: "Kathmandu", publishedAt: new Date(Date.now() - days * 864e5), ...over } })).id;
  L.new = await mk("ER-0001", 1); L.old = await mk("ER-0002", 30); L.city = await mk("ER-0003", 20, { city: "Pokhara" }); L.feat = await mk("ER-0004", 10, { featured: true });
  L.gone = await mk("ER-0005", 5, { status: "sold" });
  const boost = (listingId: number, place: string, over: object = {}) => db.boost.create({ data: { tenantId: t.id, listingId, place, days: 7, startOn: dayOf(today()), endOn: dayOf(addDays(today(), 6)), status: "paid", paidAt: new Date(), ...over } });
  await boost(L.old, "home");
  await boost(L.old, "search");
  await boost(L.city, "city", { city: "pokhara" });
  await boost(L.gone, "search"); // sold: not shown
  await boost(L.new, "home", { status: "awaiting" }); // not paid: not shown
  await boost(L.new, "search", { startOn: dayOf(addDays(today(), 3)), endOn: dayOf(addDays(today(), 9)) }); // later
});
afterAll(async () => { await app.close(); });

describe("boosted listings on the website", () => {
  it("puts home boosts first in the featured row, marked sponsored, then the free featured picks", async () => {
    const d = (await get("/featured-property-list")).json().data;
    expect(d.map((x: { property_code: string; sponsored: string | null }) => [x.property_code, x.sponsored])).toEqual([["ER-0002", "home"], ["ER-0004", null]]);
  });

  it("puts search boosts at the top of buy and search lists, then the newest", async () => {
    const sale = (await get("/sale")).json();
    expect(sale.data.map((x: { property_code: string }) => x.property_code)).toEqual(["ER-0002", "ER-0001", "ER-0005", "ER-0004", "ER-0003"]);
    expect(sale.data[0].sponsored).toBe("search");
    expect(sale.total).toBe(5);
    // Page 2 carries on without repeating the boosted one.
    const p2 = (await get("/sale?per_page=2&page=2")).json().data.map((x: { property_code: string }) => x.property_code);
    expect(p2).toEqual(["ER-0005", "ER-0004"]);
    // A price sort shows the plain order.
    expect((await get("/search?price_order=oldest")).json().data[0].sponsored).toBeNull();
  });

  it("shows city boosts when the search is for that city", async () => {
    const d = (await get("/search?keyword=Pokhara")).json().data;
    expect(d[0]).toMatchObject({ property_code: "ER-0003", sponsored: "city" });
    expect((await get("/search?city=pokhara")).json().data[0].property_code).toBe("ER-0003");
  });

  it("counts views and clicks of running boosts, not bots", async () => {
    expect((await post("/promote/seen", { place: "search", ids: [L.old, L.new] })).statusCode).toBe(200);
    expect((await post("/promote/click", { place: "search", id: L.old })).statusCode).toBe(200);
    await post("/promote/seen", { place: "search", ids: [L.old] }, "Googlebot/2.1");
    await post("/promote/seen", { place: "search", ids: [L.old] }, undefined, ""); // a browser-like agent with no Accept-Language ("" = none sent): a script, not a visitor
    expect((await post("/promote/seen", { place: "sky", ids: [1] })).statusCode).toBe(422);
    const b = await app.db!.boost.findFirstOrThrow({ where: { listingId: L.old, place: "search" } });
    expect([b.views, b.clicks]).toEqual([1, 1]);
    const later = await app.db!.boost.findFirstOrThrow({ where: { listingId: L.new, place: "search" } });
    expect(later.views).toBe(0);
  });
});
