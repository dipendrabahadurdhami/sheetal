import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-upload-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
// The smallest real PNG (1×1 pixel).
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

const call = (who: string | null, method: "GET" | "POST" | "DELETE", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: who ? { authorization: `Bearer ${tok[who]}` } : {}, remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

/** A multipart form like the website's FormData. */
function form(fields: Record<string, string | string[]>, filesIn: Record<string, Buffer[]>) {
  const b = `----sheetal${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${x}\r\n`));
  for (const [k, list] of Object.entries(filesIn)) for (const [i, data] of list.entries()) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"; filename="p${i}.png"\r\nContent-Type: image/png\r\n\r\n`), data, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}
const post = (who: string, fields: Record<string, string | string[]>, photos: Record<string, Buffer[]> = { feature_image: [PNG] }) => {
  const f = form(fields, photos);
  return app.inject({ method: "POST", url: "/v1/post-property", payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${tok[who]}` } });
};
const listing = { name: "House for sale in Budhanilkantha", purpose_id: "1", total_price: "35000000", district: "Kathmandu", tol: "Budhanilkantha", bedrooms: "5", owner_name: "Hari", owner_info: "9800000000" };

async function person(key: string, email: string, verified = true) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: verified ? new Date() : null } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), API_URL: "https://api.test", MEDIA_DIR: media, SUPPORT_EMAIL: "team@sheetal.test" }));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, reviews, favourites, upgrade_requests, outbound_emails RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("agencyOwner", "owner@everest.test");
  await person("buyer", "buyer@gmail.test");
  await person("newbie", "newbie@gmail.test", false);
  const t = await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.agencyOwner!, name: "Everest Realty", type: "agency", planId: "agency-business", email: "office@everest.test" }));
  ids.tenant = t.id;
  await db.listing.create({ data: { code: "SP-0001", slug: "flat-1", tenantId: t.id, purpose: "rent", kind: "rentout", category: "Apartment", propertyType: "Flat", title: "Flat on rent in Baneshwor", status: "published", price: 30000n, facilities: ["Parking", "Water Supply"] } });
});
afterAll(async () => { await app.close(); });

describe("favourites", () => {
  it("needs a login, then saves, lists and removes", async () => {
    expect((await call(null, "POST", "/add-to-favourite", { property_id: 1 })).statusCode).toBe(401);
    expect((await call("buyer", "POST", "/add-to-favourite", { property_id: 1 })).statusCode).toBe(200);
    expect((await call("buyer", "POST", "/add-to-favourite", { property_id: 1 })).statusCode).toBe(200); // twice is fine
    const list = (await call("buyer", "GET", "/user-favourites-list")).json().data;
    expect(list).toHaveLength(1);
    expect(list[0].property).toMatchObject({ property_code: "SP-0001" });
    await call("buyer", "POST", "/remove-from-favourite", { property_id: 1 });
    expect((await call("buyer", "GET", "/user-favourites-list")).json().data).toHaveLength(0);
    expect((await call("buyer", "POST", "/add-to-favourite", { property_id: 999 })).statusCode).toBe(404);
  });
});

describe("enquiries", () => {
  it("sends a contact to the listing's business, with an email to them", async () => {
    const res = await call(null, "POST", "/contact-agent", { property_id: 1, name: "Sita", phone: "+977 984-1234567", contact_form: "Is it still available?", reasons: ["Price"] });
    expect(res.statusCode).toBe(200);
    const lead = await app.db!.lead.findFirstOrThrow({ where: { kind: "contact_agent" } });
    expect(lead).toMatchObject({ tenantId: ids.tenant, listingId: 1, name: "Sita", phone: "+9779841234567", message: "Is it still available?", status: "new" });
    expect(lead.details).toMatchObject({ reasons: ["Price"] });
    const mail = await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "office@everest.test" } });
    expect(mail.subject).toContain("SP-0001");
  });

  it("takes a site visit and a buyer requirement sent as a form", async () => {
    expect((await call(null, "POST", "/schedule-tour", { property_id: 1, name: "Ram", phone: "9841000000", date: "2026-11-08", time: "11:00" })).json().message).toContain("Visit requested");
    const f = form({ name: "Gita", phone: "9800000001", tenant_option: "Buy", property_type: "House", prefered_location: "Lalitpur", maximum_budget: "40000000", "facilities[]": ["Parking", "Garden"] }, {});
    const res = await app.inject({ method: "POST", url: "/v1/requirement-form", payload: f.payload, headers: f.headers });
    expect(res.statusCode).toBe(200);
    const req = await app.db!.lead.findFirstOrThrow({ where: { kind: "requirement" } });
    expect(req.tenantId).toBeNull(); // no listing: it goes to Sheetal
    expect(req.details).toMatchObject({ location: "Lalitpur", max_budget: "40000000", facilities: ["Parking", "Garden"] });
  });

  it("needs a way to reply, and ignores bots filling the hidden field", async () => {
    expect((await call(null, "POST", "/contact-agent", { property_id: 1, name: "No Contact" })).statusCode).toBe(400);
    expect((await call(null, "POST", "/contact-agent", { property_id: 1, name: "Bot", phone: "1", website: "http://spam" })).statusCode).toBe(422);
  });
});

describe("reviews", () => {
  it("lets people review a listing or a business once each, and shows them", async () => {
    expect((await call(null, "POST", "/reviews", { property_id: 1, rating: 5 })).statusCode).toBe(401);
    await call("buyer", "POST", "/reviews", { type: "property", property_id: 1, rating: 4, comment: "Good flat" });
    await call("buyer", "POST", "/reviews", { type: "property", property_id: 1, rating: 5, comment: "Great flat" }); // changes their review
    const list = (await call(null, "GET", "/reviews-public?type=property&property_id=1")).json().data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ rating: 5, comment: "Great flat", user: { name: "buyer" } });
    await call("buyer", "POST", "/reviews", { type: "agent", agent_id: ids.tenant, rating: 5 });
    expect((await call(null, "GET", `/reviews-public?type=agent&agent_id=${ids.tenant}`)).json().data).toHaveLength(1);
  });

  it("won't let a business review itself", async () => {
    expect((await call("agencyOwner", "POST", "/reviews", { type: "property", property_id: 1, rating: 5 })).statusCode).toBe(400);
    expect((await call("agencyOwner", "POST", "/reviews", { type: "agent", agent_id: ids.tenant, rating: 5 })).statusCode).toBe(400);
  });
});

describe("posting a property", () => {
  it("asks for a verified email first", async () => {
    expect((await post("newbie", listing)).statusCode).toBe(403);
  });

  it("posts into the person's own (new Starter) workspace, waiting for review, with photos stored", async () => {
    const res = await post("buyer", { ...listing, "facilities_id[]": ["1"] }, { feature_image: [PNG], "gallery_images[]": [PNG, PNG] });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toMatchObject({ listing_status: "pending", purpose: "Sale", total_price: 35000000, district: "Kathmandu" });
    expect(d.property_code).toMatch(/^SP-\d{4}$/);
    const row = await app.db!.listing.findUniqueOrThrow({ where: { id: d.id }, include: { photos: true } });
    expect(row.photos).toHaveLength(3);
    expect(existsSync(join(media, "property", "main", row.photos[0]!.file))).toBe(true);
    expect(row.private).toMatchObject({ owner: "Hari", owner_phone: "9800000000" });
    expect(row.facilities).toEqual(["Parking"]);
    const ws = await app.db!.membership.findFirstOrThrow({ where: { userId: ids.buyer }, include: { tenant: true } });
    expect(ws.tenant.planId).toBe("agency-starter");
    expect(row.tenantId).toBe(ws.tenantId);
    ids.posted = String(d.id);
  });

  it("keeps it off the website until it is approved, and lists it under My properties", async () => {
    expect((await call(null, "GET", `/property-detail/${ids.posted}`)).statusCode).toBe(404);
    const mine = (await call("buyer", "GET", "/user-property")).json().data;
    expect(mine.map((x: { id: number; listing_status: string }) => [x.id, x.listing_status])).toEqual([[Number(ids.posted), "pending"]]);
  });

  it("holds Starter to one listing", async () => {
    const res = await post("buyer", listing);
    expect(res.statusCode).toBe(402);
    expect(res.json().message).toContain("one listing");
  });

  it("refuses files that aren't images", async () => {
    const res = await post("agencyOwner", listing, { feature_image: [Buffer.from("<?php system($_GET['x']); ?>")] });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("JPG, PNG or WebP");
  });

  it("only lets the owner mark sold or remove, and only live listings can be sold", async () => {
    expect((await call("buyer", "POST", "/mark-as-sold", { property_id: Number(ids.posted), sold: true })).statusCode).toBe(400);
    expect((await call("buyer", "POST", "/mark-as-sold", { property_id: 1, sold: true })).statusCode).toBe(403);
    expect((await call("agencyOwner", "POST", "/mark-as-sold", { property_id: 1, sold: true })).json().message).toBe("Marked as rented out.");
    expect((await call(null, "GET", "/property-detail/1")).json().data.property_status).toBe("RENTED OUT");
    expect((await call("buyer", "DELETE", `/delete-property/${ids.posted}`)).statusCode).toBe(200);
    expect((await call("buyer", "GET", "/user-property")).json().data).toHaveLength(0);
  });
});

describe("plans and upgrades", () => {
  it("lists the three plans of a type with prices for each period", async () => {
    const plans = (await call(null, "GET", "/subscription-plans?type=hotel")).json().data;
    expect(plans.map((p: { name: string }) => p.name)).toEqual(["Starter", "Business", "Pro"]);
    expect(plans[1].periods.find((x: { months: number }) => x.months === 12)).toMatchObject({ price: 10980, saving: 7020 });
  });

  it("records an upgrade request and tells Sheetal's team", async () => {
    expect((await call("agencyOwner", "POST", "/request-upgrade", { requested_plan: "agency-pro", months: 12 })).statusCode).toBe(200);
    expect(await app.db!.upgradeRequest.findFirstOrThrow({ where: { tenantId: ids.tenant } })).toMatchObject({ planId: "agency-pro", months: 12, status: "pending" });
    expect((await app.db!.outboundEmail.findFirstOrThrow({ where: { to: "team@sheetal.test" } })).subject).toContain("Pro");
    expect((await call("agencyOwner", "POST", "/request-upgrade", { requested_plan: "agency-starter" })).statusCode).toBe(400);
  });
});
