// Free website posting (P3-BE-11): fair use per person per Nepal day instead of plan limits (for businesses on "shadow" or "apps"), a checked
// business's post goes live at once while everyone else's waits for review, the "Start free" hand-off, and no public answer saying
// "verified" or showing a PAN.
// Where it fits: website/backend/src/modules/posting/routes.ts, catalog/present.ts and the platform.posting setting (platform/src/settings/posting.ts).
// Run with: npm run test -w @sheetal/website-api
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-free-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

const call = (who: string | null, method: "GET" | "POST", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: who ? { authorization: `Bearer ${tok[who]}` } : {}, remoteAddress: `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

function post(who: string, title: string) {
  const b = `----free${Date.now()}${Math.random()}`;
  const fields = { name: title, purpose_id: "1", total_price: "9000000", district: "Lalitpur", tol: "Jhamsikhel" };
  const parts: Buffer[] = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="feature_image"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`));
  return app.inject({ method: "POST", url: "/v1/post-property", payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${b}`, authorization: `Bearer ${tok[who]}` }, remoteAddress: `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
}

async function owner(key: string, business: string, o: { mode: string; checked?: boolean; plan?: string }) {
  const u = await app.db!.user.create({ data: { email: `${key}@free.test`, userName: key, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  const t = await app.db!.$transaction((tx) => createWorkspace(tx, { ownerId: u.id, name: business, type: "agency", planId: o.plan ?? "agency-starter", email: `${key}@biz.test` }));
  await app.db!.tenant.update({ where: { id: t.id }, data: { billingMode: o.mode, pan: "301234567", ...(o.checked ? { verification: "verified", verifiedAt: new Date() } : {}) } });
  ids[`${key}Biz`] = t.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), API_URL: "https://api.test", MEDIA_DIR: media, SUPPORT_EMAIL: "team@sheetal.test" }));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, reviews, favourites, upgrade_requests, outbound_emails RESTART IDENTITY CASCADE`);
  await db.$executeRawUnsafe(`DELETE FROM app_settings WHERE key = 'platform.posting'`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await owner("plain", "Plain Realty", { mode: "apps" });
  await owner("checked", "Checked Realty", { mode: "apps", checked: true });
  await owner("legacy", "Legacy Realty", { mode: "plans" });
  const u = await db.user.create({ data: { email: "walkin@free.test", userName: "walkin", emailVerifiedAt: new Date() } });
  ids.walkin = u.id;
  tok.walkin = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
});
afterAll(async () => { await app.close(); });

describe("free posting", () => {
  it("a business on apps is not held to the old Starter limit, and its posts wait for review", async () => {
    for (let i = 1; i <= 2; i++) {
      const r = await post("plain", `Flat number ${i} in Jhamsikhel`);
      expect(r.statusCode).toBe(200);
      expect(r.json().data.listing_status).toBe("pending");
    }
  });

  it("fair use: the 6th post of the day is refused, with the limit in the answer", async () => {
    for (let i = 3; i <= 5; i++) expect((await post("plain", `Flat number ${i} in Jhamsikhel`)).statusCode).toBe(200);
    const r = await post("plain", "Flat number 6 in Jhamsikhel");
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ code: "posting_fair_use" });
    expect(await app.db!.listing.count({ where: { userId: ids.plain } })).toBe(5);
  });

  it("a checked business's post goes live at once (no review), with an audit line; the answer never says why", async () => {
    const r = await post("checked", "House for sale in Sanepa");
    expect(r.statusCode).toBe(200);
    expect(r.json().data.listing_status).toBe("published");
    expect(JSON.stringify(r.json())).not.toMatch(/verif/i);
    const row = await app.db!.listing.findUniqueOrThrow({ where: { id: r.json().data.id } });
    expect(row.publishedAt).not.toBeNull();
    expect((await call(null, "GET", `/property-detail/${row.id}`)).statusCode).toBe(200);
    expect(await app.db!.auditLog.count({ where: { action: "listing.published", tenantId: ids.checkedBiz } })).toBe(1);
  });

  it("a checked business gets the higher daily limit", async () => {
    for (let i = 2; i <= 6; i++) expect((await post("checked", `House number ${i} in Sanepa`)).statusCode).toBe(200);
  });

  it("the limits are a setting staff can change", async () => {
    await app.db!.appSetting.upsert({ where: { key: "platform.posting" }, create: { key: "platform.posting", value: { fairUse: { perDay: 6, perDayChecked: 20 }, checkedGoLive: true } }, update: { value: { fairUse: { perDay: 6, perDayChecked: 20 }, checkedGoLive: true } } });
    // The settings store caches for 30 seconds: a fresh app reads the new value.
    const fresh = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), API_URL: "https://api.test", MEDIA_DIR: media, SUPPORT_EMAIL: "team@sheetal.test" }));
    const old = app;
    app = fresh;
    try {
      expect((await post("plain", "Flat number 6 in Jhamsikhel")).statusCode).toBe(200);
      expect((await post("plain", "Flat number 7 in Jhamsikhel")).statusCode).toBe(429);
    } finally {
      app = old;
      await fresh.close();
    }
  });

  it("a business still on plans keeps its plan's listing limit (MB 8.6)", async () => {
    expect((await post("legacy", "Flat for rent in Patan one")).statusCode).toBe(200);
    expect((await post("legacy", "Flat for rent in Patan two")).statusCode).toBe(402);
  });
});

describe("Start free", () => {
  it("makes a free business for someone without one and points to the marketplace", async () => {
    const r = await call("walkin", "POST", "/start-free", { app: "crm" });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ created: true, link: "/business/marketplace?app=crm" });
    expect(await app.db!.membership.count({ where: { userId: ids.walkin } })).toBe(1);
  });

  it("uses the person's own business when they have one, and refuses an app that isn't sold", async () => {
    expect((await call("plain", "POST", "/start-free", {})).json().data).toMatchObject({ created: false, business_id: ids.plainBiz, link: "/business/marketplace" });
    expect((await call("plain", "POST", "/start-free", { app: "payroll" })).statusCode).toBe(400); // coming soon
    expect((await call("plain", "POST", "/start-free", { app: "nope" })).statusCode).toBe(400);
    expect((await call(null, "POST", "/start-free", {})).statusCode).toBe(401);
  });

  it("the old plans list points to the public catalog", async () => {
    expect((await call(null, "GET", "/subscription-plans?type=agency")).json().moved_to).toBe("/v1/public/catalog");
  });
});

describe("public answers", () => {
  it("never say 'verified' and never show a PAN, for checked and other businesses alike", async () => {
    const live = await app.db!.listing.findFirstOrThrow({ where: { tenantId: ids.checkedBiz, status: "published" } });
    const urls = [
      "/agent-list", `/agent-detail/${ids.checkedBiz}`, `/agent-detail/${ids.plainBiz}`, `/agent-properties/${ids.checkedBiz}`,
      `/property-detail/${live.id}`, `/property-by-slug/${live.slug}`, "/all-properties", "/search", "/featured-property-list", "/public/catalog", "/subscription-plans",
    ];
    for (const u of urls) {
      const r = await call(null, "GET", u);
      expect(r.statusCode, u).toBe(200);
      expect(r.body, u).not.toMatch(/verif/i);
      expect(r.body, u).not.toContain("301234567");
      expect(r.body, u).not.toMatch(/"pan"/i);
    }
  });
});
