import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { cached } from "@sheetal/backend-core/lib/cache";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { notFound } from "@sheetal/backend-core/lib/errors";
import { isBotRequest } from "@sheetal/backend-core/lib/bots";
import { agencyJson, listingCard, listingDetail, mediaBase, type AgencyRow, type ListingRow } from "./present.js";

// Public catalogue: lists, search, property pages, map pins, agencies and photos.
// Paths and response shapes match the website (api/endpoints.js), so pages work unchanged.

/** Listings visitors can see. Sold and rented ones stay visible with their label. */
const LIVE: Prisma.ListingWhereInput = { status: { in: ["published", "sold", "rented"] } };
/** Buy and rent pages show properties; stays, projects and investments have their own pages. */
const PROPERTIES: Prisma.ListingWhereInput = { AND: [LIVE, { kind: { in: ["sell", "rentout"] } }] };
/** Kinds with their own page on the website, by path. */
const KIND_PAGES = { stays: ["stay_hotel", "stay_unit"], projects: ["project"], investments: ["invest"] } as const;
const withPhotos = { photos: { orderBy: { sort: "asc" } } } as const;
const LIST_TTL = 60; // seconds; cleared when a listing changes (cache prefix "catalog:")

const paging = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(12),
});

const searchQuery = paging.extend({
  keyword: z.string().trim().max(100).optional(),
  advertisement_purpose: z.string().trim().toLowerCase().optional(),
  property_type: z.string().trim().max(60).optional(),
  category: z.string().trim().max(60).optional(),
  property_status: z.string().trim().toLowerCase().optional(),
  district: z.string().trim().max(60).optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).max(50).optional(),
  price_order: z.enum(["low_to_high", "high_to_low", "oldest", "newest"]).optional(),
});
type Search = z.infer<typeof searchQuery>;

const all = (v?: string) => !v || v.toLowerCase() === "all";
const ci = (v: string) => ({ equals: v, mode: "insensitive" as const });
const has = (v: string) => ({ contains: v, mode: "insensitive" as const });

function whereFor(q: Partial<Search>): Prisma.ListingWhereInput {
  const and: Prisma.ListingWhereInput[] = [PROPERTIES];
  const kw = q.keyword?.replace(/^#/, "");
  if (kw) and.push({ OR: [{ title: has(kw) }, { area: has(kw) }, { city: has(kw) }, { district: has(kw) }, { code: has(kw) }, { propertyType: has(kw) }] });
  if (!all(q.advertisement_purpose)) and.push({ purpose: q.advertisement_purpose!.startsWith("rent") ? "rent" : "sale" });
  if (!all(q.property_type)) and.push({ OR: [{ propertyType: ci(q.property_type!) }, { category: ci(q.property_type!) }] });
  if (!all(q.category)) and.push({ category: ci(q.category!) });
  if (!all(q.property_status)) {
    const s = q.property_status!;
    and.push({ status: s.startsWith("sold") ? "sold" : s.startsWith("rent") ? "rented" : "published" });
  }
  if (q.district) and.push({ district: ci(q.district) });
  if (q.min_price) and.push({ price: { gte: BigInt(Math.floor(q.min_price)) } });
  if (q.max_price) and.push({ price: { lte: BigInt(Math.floor(q.max_price)) } });
  if (q.bedrooms) and.push({ bedrooms: { gte: q.bedrooms } });
  return { AND: and };
}

function orderFor(o?: Search["price_order"]): Prisma.ListingOrderByWithRelationInput[] {
  if (o === "low_to_high") return [{ price: { sort: "asc", nulls: "last" } }, { id: "desc" }];
  if (o === "high_to_low") return [{ price: { sort: "desc", nulls: "last" } }, { id: "desc" }];
  if (o === "oldest") return [{ publishedAt: "asc" }, { id: "asc" }];
  return [{ publishedAt: "desc" }, { id: "desc" }];
}

const cacheKey = (name: string, q: object) => `catalog:${name}:${JSON.stringify(Object.entries(q).sort())}`;

export async function catalogRoutes(app: FastifyInstance) {
  const base = mediaBase(app.config);

  async function page(where: Prisma.ListingWhereInput, q: { page: number; per_page: number }, orderBy = orderFor()) {
    const db = dbOf(app);
    const [total, rows] = await Promise.all([
      db.listing.count({ where }),
      db.listing.findMany({ where, orderBy, include: withPhotos, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    ]);
    const meta = { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / q.per_page)), per_page: q.per_page };
    return { status: 200, data: rows.map((l) => listingCard(l, base)), meta, ...meta };
  }

  async function agencyOf(tenantId: string | null): Promise<AgencyRow | null> {
    if (!tenantId) return null;
    return dbOf(app).tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, city: true, email: true, phone: true } });
  }

  async function showListing(where: Prisma.ListingWhereInput, request: { headers: Record<string, string | string[] | undefined> }) {
    const db = dbOf(app);
    const l: ListingRow | null = await db.listing.findFirst({ where: { AND: [LIVE, where] }, include: withPhotos });
    if (!l) throw notFound("This property isn't available any more.");
    // People only: bots and search engines don't add views.
    if (!isBotRequest(request.headers as { "user-agent"?: string })) {
      await db.listing.update({ where: { id: l.id }, data: { views: { increment: 1 } } });
    }
    return { status: 200, data: listingDetail(l, base, await agencyOf(l.tenantId)) };
  }

  app.get("/all-properties", async (request) => {
    const q = paging.parse(request.query);
    return cached(app.cache, cacheKey("all", q), LIST_TTL, () => page(PROPERTIES, q));
  });

  for (const purpose of ["sale", "rent"] as const) {
    app.get(`/${purpose}`, async (request) => {
      const q = paging.parse(request.query);
      return cached(app.cache, cacheKey(purpose, q), LIST_TTL, () => page({ AND: [PROPERTIES, { purpose }] }, q));
    });
  }

  // Stays, projects and investments, each with its own page on the website.
  for (const [path, kinds] of Object.entries(KIND_PAGES)) {
    app.get(`/${path}`, async (request) => {
      const q = paging.extend({ per_page: z.coerce.number().int().min(1).max(100).default(24) }).parse(request.query);
      return cached(app.cache, cacheKey(path, q), LIST_TTL, () => page({ AND: [LIVE, { kind: { in: [...kinds] } }] }, q));
    });
  }

  app.get("/search", async (request) => {
    const q = searchQuery.parse(request.query);
    return cached(app.cache, cacheKey("search", q), LIST_TTL, () => page(whereFor(q), q, orderFor(q.price_order)));
  });

  app.get("/featured-property-list", async () =>
    cached(app.cache, "catalog:featured", LIST_TTL, async () => {
      const rows = await dbOf(app).listing.findMany({
        where: { AND: [LIVE, { featured: true }] }, include: withPhotos,
        orderBy: [{ featuredOrder: "asc" }, { publishedAt: "desc" }], take: 12,
      });
      return { status: 200, data: rows.map((l) => listingCard(l, base)) };
    }));

  app.get<{ Params: { id: string } }>("/property-detail/:id", async (request) => {
    const id = z.coerce.number().int().positive().safeParse(request.params.id);
    if (!id.success) throw notFound("This property isn't available any more.");
    return showListing({ id: id.data }, request);
  });
  app.get<{ Params: { slug: string } }>("/property-by-slug/:slug", async (request) => showListing({ slug: request.params.slug.slice(0, 200) }, request));
  app.get<{ Params: { code: string } }>("/property-by-code/:code", async (request) => {
    const code = request.params.code.replace(/^#/, "").trim().toUpperCase().slice(0, 20);
    return showListing(/^\d+$/.test(code) ? { OR: [{ id: Number(code) }, { code }] } : { code }, request);
  });

  // Every live listing's approximate point in one small response, for the map.
  app.get("/map-pins", async () =>
    cached(app.cache, "catalog:pins", LIST_TTL, async () => {
      const rows = await dbOf(app).listing.findMany({ where: { AND: [LIVE, { lat: { not: null } }, { lng: { not: null } }] }, include: { photos: { orderBy: { sort: "asc" }, take: 1 } }, orderBy: { id: "desc" } });
      return {
        status: 200,
        data: rows.map((l) => {
          const c = listingCard(l, base);
          return { id: c.id, url: c.url, name: c.name, kind: c.kind, property_type: c.property_type, category: c.category, purpose: c.purpose, district: c.district, property_location: c.property_location, total_price: c.total_price, bedroom: c.bedroom, property_area: c.property_area, property_status: c.property_status, lat: c.lat, lng: c.lng, feature_image: c.thumbnail, location_approximate: true };
        }),
      };
    }));

  // Choices for the search filters, from what is actually listed.
  app.get("/property-attributes", async () =>
    cached(app.cache, "catalog:attributes", 300, async () => {
      const db = dbOf(app);
      const [types, cats, facs] = await Promise.all([
        db.listing.groupBy({ by: ["propertyType"], where: { AND: [LIVE, { propertyType: { not: null } }] }, orderBy: { propertyType: "asc" } }),
        db.listing.groupBy({ by: ["category"], where: LIVE, orderBy: { category: "asc" } }),
        db.$queryRaw<{ f: string }[]>`SELECT DISTINCT unnest(facilities) AS f FROM listings WHERE status IN ('published','sold','rented') ORDER BY f`,
      ]);
      const opts = (names: string[]) => names.map((name, i) => ({ id: i + 1, name }));
      return {
        status: 200,
        data: {
          property_types: opts(types.map((t) => t.propertyType!)),
          categories: opts(cats.map((c) => c.category)),
          purposes: opts(["Sale", "Rent"]),
          property_status: opts(["AVAILABLE", "SOLD OUT", "RENTED OUT"]),
          facilities: opts(facs.map((f) => f.f)),
        },
      };
    }));

  app.get("/search/suggestions", async (request) => {
    const { q } = z.object({ q: z.string().trim().max(60).default("") }).parse(request.query);
    return cached(app.cache, cacheKey("suggest", { q: q.toLowerCase() }), LIST_TTL, async () => {
      const db = dbOf(app);
      const like = q ? { contains: q, mode: "insensitive" as const } : undefined;
      const [districts, cities, areas, props] = await Promise.all([
        db.listing.groupBy({ by: ["district"], where: { AND: [LIVE, { district: like ?? { not: null } }] }, _count: true, orderBy: { _count: { district: "desc" } }, take: 4 }),
        db.listing.groupBy({ by: ["city"], where: { AND: [LIVE, { city: like ?? { not: null } }] }, _count: true, orderBy: { _count: { city: "desc" } }, take: 5 }),
        db.listing.groupBy({ by: ["area", "city"], where: { AND: [LIVE, { area: like ?? { not: null } }] }, _count: true, orderBy: { _count: { area: "desc" } }, take: 6 }),
        q ? db.listing.findMany({ where: { AND: [LIVE, { OR: [{ title: like }, { code: like }] }] }, select: { id: true, title: true, area: true, city: true }, take: 4, orderBy: { id: "desc" } }) : Promise.resolve([]),
      ]);
      return {
        districts: districts.map((d) => ({ name: d.district, type: "district" })),
        cities: cities.map((c) => ({ name: c.city, type: "city" })),
        localities: areas.map((a) => ({ name: a.area, locality: a.city, type: "locality" })),
        properties: props.map((p) => ({ name: p.title, locality: [p.area, p.city].filter(Boolean).join(", "), type: "property", id: p.id })),
      };
    });
  });

  // Agencies: active agency businesses with their live listing counts.
  app.get("/agent-list", async () =>
    cached(app.cache, "catalog:agencies", LIST_TTL, async () => {
      const db = dbOf(app);
      const [agencies, counts] = await Promise.all([
        db.tenant.findMany({ where: { type: "agency", status: { in: ["active", "trial"] } }, select: { id: true, name: true, city: true, email: true, phone: true }, orderBy: { name: "asc" } }),
        db.listing.groupBy({ by: ["tenantId"], where: LIVE, _count: true }),
      ]);
      const n = new Map(counts.map((c) => [c.tenantId, c._count]));
      return { status: 200, data: agencies.map((a) => agencyJson({ ...a, listings: n.get(a.id) ?? 0 })) };
    }));

  app.get<{ Params: { id: string } }>("/agent-detail/:id", async (request) => {
    const a = await agencyOf(request.params.id.slice(0, 40));
    if (!a) throw notFound("Agency not found.");
    const listings = await dbOf(app).listing.count({ where: { AND: [LIVE, { tenantId: a.id }] } });
    return { status: 200, data: agencyJson({ ...a, listings }) };
  });

  app.get<{ Params: { id: string } }>("/agent-properties/:id", async (request) => {
    const q = paging.extend({ per_page: z.coerce.number().int().min(1).max(100).default(60) }).parse(request.query);
    return page({ AND: [LIVE, { tenantId: request.params.id.slice(0, 40) }] }, q);
  });
}

// Photos from MEDIA_DIR (local development and small servers). Production serves them from object storage.
const SIZES = new Set(["main", "thumbnail"]);
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpe?g|png|webp)$/i;
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { size: string; file: string } }>("/media/property/:size/:file", { config: { rateLimit: false } }, async (request, reply) => {
    const { size, file } = request.params;
    const dir = app.config.MEDIA_DIR;
    if (!dir || !SIZES.has(size) || !SAFE_FILE.test(file)) throw notFound("Photo not found.");
    const path = join(dir, "property", size, file);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw notFound("Photo not found.");
    const ext = file.split(".").pop()!.toLowerCase();
    return reply
      .header("content-type", TYPES[ext] ?? "application/octet-stream")
      .header("content-length", info.size)
      .header("cache-control", "public, max-age=2592000, immutable")
      .send(createReadStream(path));
  });
}
