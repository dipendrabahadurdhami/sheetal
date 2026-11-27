import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { applyPayment } from "@sheetal/backend-core/domain/billing";
import { addDays, today } from "@sheetal/backend-core/domain/promote";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-banners-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const pic: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency! } });
// A plain one-colour PNG of the given size (no image library needed).
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const png = async (w: number, h: number) => {
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x66)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
};
const booking = (over: object = {}) => ({ days: 7, link: "https://bank.example.com/loan", title: "Home loans at 9%", button: "Apply", desktop: { data: pic.desktop }, mobile: { data: pic.mobile }, ...over });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, invoices, payments, banners RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "agent", "staff"]) {
    const u = await db.user.create({ data: { email: `${k}@banner.test`, userName: k, emailVerifiedAt: new Date(), ...(k === "staff" ? { platformRole: "super_admin" } : {}) } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key: "agent" } })).id, status: "active" } });
  pic.desktop = await png(1920, 600);
  pic.mobile = await png(1080, 1080);
  pic.wrong = await png(1200, 400);
  await db.appSetting.create({ data: { key: "promote", value: { hero: { price: 1500, spots: 1, active: true } } } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("home page banners", () => {
  it("shows the price, spots and sizes", async () => {
    const d = (await call("owner", "GET", "/promote/banners")).json().data;
    expect(d).toMatchObject({ price: 1500, spots: 1, sizes: { desktop: { width: 1920, height: 600 }, mobile: { width: 1080, height: 1080 } }, rows: [] });
    const q = (await call("owner", "GET", "/promote/banners/quote?days=7")).json().data;
    expect(q).toMatchObject({ total: 10500, startOn: today(), endOn: addDays(today(), 6) });
  });

  it("checks who books, the picture sizes and the link", async () => {
    expect((await call("agent", "POST", "/promote/banners", booking())).statusCode).toBe(403);
    const wrong = await call("owner", "POST", "/promote/banners", booking({ desktop: { data: pic.wrong } }));
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().message).toMatch(/exactly 1920 × 600/);
    expect((await call("owner", "POST", "/promote/banners", booking({ mobile: { data: Buffer.from("not a picture at all").toString("base64") } }))).statusCode).toBe(400);
    expect((await call("owner", "POST", "/promote/banners", booking({ link: "javascript:alert(1)" }))).statusCode).toBe(422);
    expect(await app.db!.banner.count()).toBe(0);
  });

  it("books with an invoice; paid, it waits for the picture check; the next booking starts after it", async () => {
    const r = await call("owner", "POST", "/promote/banners", booking());
    expect(r.statusCode).toBe(200);
    ids.banner = r.json().data.id;
    const db = app.db!;
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: r.json().data.invoiceId } });
    expect(inv).toMatchObject({ kind: "banner", total: 10500 });
    // One spot: the next booking moves to the first free day.
    expect((await call("owner", "GET", "/promote/banners/quote?days=3")).json().data).toMatchObject({ startOn: addDays(today(), 7), moved: true });
    const p = await db.payment.create({ data: { invoiceId: inv.id, tenantId: ids.agency!, provider: "esewa", amount: inv.total, ref: "TBANNER1" } });
    await applyPayment(db, app.mailer, { paymentId: p.id, siteUrl: "https://sheetal.test" });
    const b = (await call("owner", "GET", "/promote/banners")).json().data.rows[0];
    expect(b).toMatchObject({ phase: "review", phaseLabel: "Picture being checked", title: "Home loans at 9%" });
    expect(await db.notification.count({ where: { userId: ids.staff, title: { startsWith: "Banner picture to check" } } })).toBe(1);
    expect((await call("owner", "POST", `/promote/banners/${ids.banner}/cancel`)).statusCode).toBe(400);
  });

  it("goes back to the check when a rejected picture is replaced", async () => {
    await app.db!.banner.update({ where: { id: ids.banner }, data: { status: "rejected", reviewNote: "Logo too small" } });
    expect((await call("owner", "GET", "/promote/banners")).json().data.rows[0]).toMatchObject({ phase: "rejected", reviewNote: "Logo too small" });
    const r = await call("owner", "PUT", `/promote/banners/${ids.banner}`, { link: "https://bank.example.com/loan", title: "Home loans", button: "", desktop: { data: pic.desktop } });
    expect(r.statusCode).toBe(200);
    expect((await app.db!.banner.findUniqueOrThrow({ where: { id: ids.banner } })).status).toBe("review");
  });
});

describe("listing banners and the plan rule", () => {
  it("books a banner from a published listing: no pictures, the listing's link and title, its photos in the list", async () => {
    const db = app.db!;
    await db.banner.updateMany({ data: { status: "void" } }); // free the one spot
    const l = await db.listing.create({ data: { code: "ER-0101", slug: "lake-view-hotel", tenantId: ids.agency!, kind: "stay_hotel", purpose: "rent", category: "Hotel", title: "Lake View Hotel", status: "published", photos: { create: [{ file: "a.jpg", sort: 0 }, { file: "b.jpg", sort: 1 }] } } });
    const bare = await db.listing.create({ data: { code: "ER-0102", slug: "no-photos", tenantId: ids.agency!, purpose: "sale", category: "Land", title: "Land", status: "published" } });
    const d = (await call("owner", "GET", "/promote/banners")).json().data;
    expect(d.onPlan).toBe(true);
    expect(d.choices.map((c: { id: number }) => c.id)).toEqual([l.id]); // only listings with photos
    expect((await call("owner", "POST", "/promote/banners", { days: 7, listingId: bare.id })).statusCode).toBe(400);
    const r = await call("owner", "POST", "/promote/banners", { days: 7, listingId: l.id, title: "", button: "" });
    expect(r.statusCode).toBe(200);
    const b = await db.banner.findUniqueOrThrow({ where: { id: r.json().data.id } });
    expect(b).toMatchObject({ listingId: l.id, desktop: "", mobile: "", link: "https://sheetal.test/property/lake-view-hotel", title: "Lake View Hotel" });
    const row = (await call("owner", "GET", "/promote/banners")).json().data.rows.find((x: { id: string }) => x.id === b.id);
    expect(row.listing).toMatchObject({ code: "ER-0101" });
    expect(row.listing.photos).toHaveLength(2);
    expect(row.desktop).toBeNull();
  });

  it("books a business page banner: no pictures, the business's page and name, its newest listing covers in the list", async () => {
    const db = app.db!;
    await db.banner.updateMany({ data: { status: "void" } });
    const r = await call("owner", "POST", "/promote/banners", { days: 7, page: true, title: "", button: "" });
    expect(r.statusCode).toBe(200);
    const b = await db.banner.findUniqueOrThrow({ where: { id: r.json().data.id } });
    expect(b).toMatchObject({ listingId: null, desktop: "", mobile: "", link: `https://sheetal.test/site/${ids.agency}`, title: "Everest Realty" });
    const d = (await call("owner", "GET", "/promote/banners")).json().data;
    expect(d.page.photos.length).toBeGreaterThan(0);
    expect(d.rows.find((x: { id: string }) => x.id === b.id).page.photos.length).toBeGreaterThan(0);
    // Its link can't be changed; the words can.
    expect((await call("owner", "PUT", `/promote/banners/${b.id}`, { title: "Everest: homes in Kathmandu", button: "See homes" })).statusCode).toBe(200);
    expect(await db.banner.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ link: `https://sheetal.test/site/${ids.agency}`, title: "Everest: homes in Kathmandu" });
  });

  it("refuses a business that is not on a plan", async () => {
    const db = app.db!;
    const free = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Free Homes", type: "agency" }))).id;
    const r = await app.inject({ method: "POST", url: "/v1/promote/banners", payload: booking(), headers: { authorization: `Bearer ${tok.owner}`, "x-tenant-id": free } });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/on a plan/);
    const d = (await app.inject({ method: "GET", url: "/v1/promote/banners", headers: { authorization: `Bearer ${tok.owner}`, "x-tenant-id": free } })).json().data;
    expect(d.onPlan).toBe(false);
  });
});
