import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@sheetal/backend-core/config";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let agencyId = "";
const media = mkdtempSync(join(tmpdir(), "sheetal-media-"));
const EXACT = { lat: 27.7496863, lng: 85.3317133 };
const human = { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130", "accept-language": "en" };

const get = (url: string, headers: Record<string, string> = human) => app.inject({ method: "GET", url, headers });
const metres = (a: [number, number], b: [number, number]) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
};

beforeAll(async () => {
  mkdirSync(join(media, "property", "main"), { recursive: true });
  writeFileSync(join(media, "property", "main", "house1.jpg"), "jpeg-bytes");
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), API_URL: "https://api.test", MEDIA_DIR: media }));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE listings, tenants, plans RESTART IDENTITY CASCADE`);
  await db.plan.create({ data: { id: "agency-pro", type: "agency", name: "Pro", price: 3000, limits: {}, features: {} } });
  agencyId = (await db.tenant.create({ data: { name: "Sheetal Property", type: "agency", city: "Kathmandu", planId: "agency-pro", phone: "980-1136817" } })).id;
  const base = { tenantId: agencyId, category: "House", status: "published" as const, publishedAt: new Date("2026-01-01") };
  await db.listing.create({ data: { ...base, code: "SP-0001", slug: "house-dhapasi-1", purpose: "sale", title: "House on sale at Dhapasi", price: 33_000_000n, district: "Kathmandu", city: "Kathmandu", area: "Dhapasi", bedrooms: 5, ...EXACT,
    private: { owner: "Hari", ownerPhone: "9800000000", lalpurja: "123" }, details: { other_description: "Contact us" }, photos: { create: [{ file: "house1.jpg", sort: 0 }] } } });
  await db.listing.create({ data: { ...base, code: "SP-0002", slug: "flat-baneshwor-2", purpose: "rent", category: "Apartment", title: "Flat on rent in Baneshwor", price: 30_000n, district: "Kathmandu", area: "Baneshwor", bedrooms: 2, publishedAt: new Date("2026-02-01") } });
  await db.listing.create({ data: { ...base, code: "SP-0003", slug: "land-lalitpur-3", purpose: "sale", category: "Land", title: "Land in Lalitpur", price: 12_000_000n, district: "Lalitpur", status: "sold", publishedAt: new Date("2025-12-01") } });
  await db.listing.create({ data: { ...base, code: "SP-0004", slug: "draft-4", purpose: "sale", title: "Not finished yet", status: "draft" } });
});
afterAll(async () => { await app.close(); });

describe("lists", () => {
  it("shows live listings only, newest first, with paging", async () => {
    const res = (await get("/v1/all-properties?per_page=2")).json();
    expect(res.meta).toEqual({ total: 3, current_page: 1, last_page: 2, per_page: 2 });
    expect(res.data.map((p: { property_code: string }) => p.property_code)).toEqual(["SP-0002", "SP-0001"]);
  });

  it("splits sale and rent, and keeps sold ones visible with their label", async () => {
    const sale = (await get("/v1/sale")).json().data;
    expect(sale.map((p: { property_code: string }) => p.property_code)).toEqual(["SP-0001", "SP-0003"]);
    expect(sale[1]).toMatchObject({ property_status: "SOLD OUT", sold: 1 });
    expect((await get("/v1/rent")).json().data).toHaveLength(1);
  });

  it("filters by keyword, purpose, district, price and bedrooms, and sorts by price", async () => {
    const codes = async (qs: string) => (await get(`/v1/search?${qs}`)).json().data.map((p: { property_code: string }) => p.property_code);
    expect(await codes("keyword=dhapasi")).toEqual(["SP-0001"]);
    expect(await codes("keyword=%23SP-0002")).toEqual(["SP-0002"]);
    expect(await codes("advertisement_purpose=rent")).toEqual(["SP-0002"]);
    expect(await codes("district=lalitpur")).toEqual(["SP-0003"]);
    expect(await codes("min_price=1000000&max_price=20000000")).toEqual(["SP-0003"]);
    expect(await codes("bedrooms=3")).toEqual(["SP-0001"]);
    expect(await codes("advertisement_purpose=sale&price_order=low_to_high")).toEqual(["SP-0003", "SP-0001"]);
    expect(await codes("property_status=sold out")).toEqual(["SP-0003"]);
  });

  it("rejects silly paging instead of loading everything", async () => {
    expect((await get("/v1/all-properties?per_page=5000")).statusCode).toBe(422);
  });
});

describe("privacy", () => {
  it("never sends owner details or the exact location", async () => {
    const body = (await get("/v1/property-by-code/SP-0001")).body;
    for (const secret of ["Hari", "9800000000", "lalpurja", String(EXACT.lat), String(EXACT.lng)]) expect(body).not.toContain(secret);
  });

  it("sends an approximate point 150–350 m away, the same on every visit", async () => {
    const a = (await get("/v1/property-detail/1")).json().data;
    const b = (await get("/v1/map-pins")).json().data.find((p: { id: number }) => p.id === 1);
    const d = metres([EXACT.lat, EXACT.lng], [a.lat, a.lng]);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(400);
    expect([b.lat, b.lng]).toEqual([a.lat, a.lng]);
    expect(a.location_approximate).toBe(true);
  });
});

describe("property page", () => {
  it("opens by id, link name or code, with photos and the agency", async () => {
    for (const url of ["/v1/property-detail/1", "/v1/property-by-slug/house-dhapasi-1", "/v1/property-by-code/sp-0001", "/v1/property-by-code/1"]) {
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ id: 1, purpose: "Sale", total_price: 33_000_000, agent: { id: agencyId, company_name: "Sheetal Property" } });
    }
    const p = (await get("/v1/property-detail/1")).json().data;
    expect(p.feature_image).toBe("https://api.test/media/property/main/house1.jpg");
    expect(p.gallery_images).toHaveLength(1);
    expect(p.other_description).toBe("Contact us");
  });

  it("hides drafts and unknown listings", async () => {
    expect((await get("/v1/property-detail/4")).statusCode).toBe(404);
    expect((await get("/v1/property-by-slug/nope")).statusCode).toBe(404);
    expect((await get("/v1/property-detail/abc")).statusCode).toBe(404);
  });

  it("counts views from people, not bots", async () => {
    const views = async () => (await app.db!.listing.findUniqueOrThrow({ where: { id: 2 } })).views;
    const before = await views();
    await get("/v1/property-detail/2");
    await get("/v1/property-detail/2", { "user-agent": "Googlebot/2.1" });
    expect(await views()).toBe(before + 1);
  });
});

describe("filters, suggestions and agencies", () => {
  it("offers filter choices from what is listed", async () => {
    const d = (await get("/v1/property-attributes")).json().data;
    expect(d.categories.map((c: { name: string }) => c.name)).toEqual(["Apartment", "House", "Land"]);
    expect(d.purposes.map((c: { name: string }) => c.name)).toEqual(["Sale", "Rent"]);
  });

  it("suggests places and properties as you type", async () => {
    const s = (await get("/v1/search/suggestions?q=dhap")).json();
    expect(s.localities[0]).toMatchObject({ name: "Dhapasi", type: "locality" });
    expect(s.properties[0]).toMatchObject({ id: 1, type: "property" });
  });

  it("lists agencies with their live listing count", async () => {
    const list = (await get("/v1/agent-list")).json().data;
    expect(list).toEqual([expect.objectContaining({ id: agencyId, company_name: "Sheetal Property", listings_count: 3 })]);
    expect((await get(`/v1/agent-detail/${agencyId}`)).json().data.listings_count).toBe(3);
    expect((await get(`/v1/agent-properties/${agencyId}`)).json().meta.total).toBe(3);
    expect((await get("/v1/agent-detail/unknown")).statusCode).toBe(404);
  });
});

describe("photos", () => {
  it("serves a stored photo with long caching", async () => {
    const res = await get("/media/property/main/house1.jpg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("refuses anything outside the photo folders", async () => {
    for (const url of ["/media/property/main/..%2F..%2Fsecret.jpg", "/media/property/original/house1.jpg", "/media/property/main/house1.php", "/media/property/main/missing.jpg"]) {
      expect((await get(url)).statusCode).toBe(404);
    }
  });
});
