// The public catalogue: lists, search, property pages, map pins, filters, agencies and photos.
// Where it fits: the website's home, listing, search, map, agency and property pages.
// How it works: only live listings are shown; public lists are cached for a minute; photos are streamed from MEDIA_DIR.
// Boosted listings (Business → Promote) come first: home boosts in the featured row, search boosts at the top of buy,
// rent and search lists, city boosts at the top when the search is for their city; then the newest. Only with the
// default order: a price or date sort shows the plain order.
// Rules: owner details never leave the server; sale and rent locations are approximate; only real photo names under
// the public folders can be fetched.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { SOFTWARE } from "@sheetal/platform/billing/packs";
import { cached } from "@sheetal/backend-core/lib/cache";
import { dbOf } from "@sheetal/platform/db/client";
import { notFound } from "@sheetal/platform/core/errors";
import { isBotRequest } from "@sheetal/backend-core/lib/bots";
import { agencyJson, listingCard, listingDetail, mediaBase, type AgencyRow, type ListingRow } from "./present.js";
import { liveBoosted, type Place } from "@sheetal/backend-core/domain/promote";

/** Listings visitors can see. Sold and rented ones stay visible with their label. */
// Listings a reviewer changed today stay off the website until the changes are decided (business check-ups).
const LIVE: Prisma.ListingWhereInput = { status: { in: ["published", "sold", "rented"] }, reviewHold: false };
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
  city: z.string().trim().max(60).optional(),
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
  if (kw) and.push({ OR: [{ title: has(kw) }, { area: has(kw) }, { city: has(kw) }, { district: has(kw) }, { code: has(kw) }, { oldCodes: { has: kw.toUpperCase() } }, { propertyType: has(kw) }] });
  if (!all(q.advertisement_purpose)) and.push({ purpose: q.advertisement_purpose!.startsWith("rent") ? "rent" : "sale" });
  if (!all(q.property_type)) and.push({ OR: [{ propertyType: ci(q.property_type!) }, { category: ci(q.property_type!) }] });
  if (!all(q.category)) and.push({ category: ci(q.category!) });
  if (!all(q.property_status)) {
    const s = q.property_status!;
    and.push({ status: s.startsWith("sold") ? "sold" : s.startsWith("rent") ? "rented" : "published" });
  }
  if (q.district) and.push({ district: ci(q.district) });
  if (q.city) and.push({ city: ci(q.city) });
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

  async function page(where: Prisma.ListingWhereInput, q: { page: number; per_page: number }, orderBy = orderFor(), promo?: { places: Place[]; city?: string | null }) {
    const db = dbOf(app);
    // Boosted listings that match this list go first, on the first pages; the rest follow without them.
    const live = promo ? await liveBoosted(db, promo.places, promo.city) : [];
    const boostedRows = live.length ? await db.listing.findMany({ where: { AND: [where, { id: { in: live.map((b) => b.listingId) } }, { status: "published" }] }, include: withPhotos }) : [];
    const boosted = live.map((b) => ({ b, l: boostedRows.find((r) => r.id === b.listingId) })).filter((x) => x.l) as { b: (typeof live)[number]; l: ListingRow }[];
    const rest: Prisma.ListingWhereInput = boosted.length ? { AND: [where, { id: { notIn: boosted.map((x) => x.l.id) } }] } : where;
    const start = (q.page - 1) * q.per_page;
    const top = boosted.slice(start, start + q.per_page);
    const [restTotal, rows] = await Promise.all([
      db.listing.count({ where: rest }),
      db.listing.findMany({ where: rest, orderBy, include: withPhotos, skip: Math.max(0, start - boosted.length), take: q.per_page - top.length }),
    ]);
    const total = restTotal + boosted.length;
    const meta = { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / q.per_page)), per_page: q.per_page };
    return { status: 200, data: [...top.map((x) => listingCard(x.l, base, x.b.place)), ...rows.map((l) => listingCard(l, base))], meta, ...meta };
  }

  async function agencyOf(tenantId: string | null): Promise<AgencyRow | null> {
    if (!tenantId) return null;
    return dbOf(app).tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, city: true, email: true, phone: true, logoUrl: true, address: true, website: true, verifiedAt: true } });
  }

  async function showListing(where: Prisma.ListingWhereInput, request: { headers: Record<string, string | string[] | undefined> }) {
    const db = dbOf(app);
    const l: ListingRow | null = await db.listing.findFirst({ where: { AND: [LIVE, where] }, include: withPhotos });
    if (!l) throw notFound("This property isn't available any more.");
    // People only: bots and search engines don't add views.
    if (!isBotRequest(request.headers as { "user-agent"?: string })) {
      await db.listing.update({ where: { id: l.id }, data: { views: { increment: 1 } } });
    }
    const data: Record<string, unknown> = listingDetail(l, base, await agencyOf(l.tenantId));
    // Investments: does the business take investments online here (Business -> Settings -> Payments -> Raise funds online)?
    // Off: only the enquiry form. On: the "Invest" form records a pledge (POST /invest/:id).
    if (l.kind === "invest" && l.tenantId) {
      const t = await db.tenant.findUnique({ where: { id: l.tenantId }, select: { settings: true } });
      data.raise_funds = ((t?.settings ?? {}) as { payments?: { raiseFunds?: boolean } }).payments?.raiseFunds === true;
    }
    return { status: 200, data };
  }

  app.get("/all-properties", async (request) => {
    const q = paging.parse(request.query);
    return cached(app.cache, cacheKey("all", q), LIST_TTL, () => page(PROPERTIES, q, orderFor(), { places: ["search"] }));
  });

  for (const purpose of ["sale", "rent"] as const) {
    app.get(`/${purpose}`, async (request) => {
      const q = paging.parse(request.query);
      return cached(app.cache, cacheKey(purpose, q), LIST_TTL, () => page({ AND: [PROPERTIES, { purpose }] }, q, orderFor(), { places: ["search"] }));
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
    // City boosts show when the search is for a city: the city filter, or a keyword that is a city's name.
    const plain = !q.price_order || q.price_order === "newest";
    const city = q.city || q.keyword?.replace(/^#/, "").trim() || null;
    return cached(app.cache, cacheKey("search", q), LIST_TTL, () => page(whereFor(q), q, orderFor(q.price_order), plain ? { places: ["search", "city"], city } : undefined));
  });

  app.get("/featured-property-list", async () =>
    cached(app.cache, "catalog:featured", LIST_TTL, async () => {
      const db = dbOf(app);
      // Home boosts first (in the order they were paid), then the listings businesses picked for their free featured slots.
      const live = await liveBoosted(db, ["home"]);
      const boostedRows = live.length ? await db.listing.findMany({ where: { AND: [LIVE, { status: "published" }, { id: { in: live.map((b) => b.listingId) } }] }, include: withPhotos }) : [];
      const boosted = live.map((b) => boostedRows.find((r) => r.id === b.listingId)).filter((x): x is ListingRow => !!x);
      const rows = await db.listing.findMany({
        where: { AND: [LIVE, { featured: true }, { id: { notIn: boosted.map((l) => l.id) } }] }, include: withPhotos,
        orderBy: [{ featuredOrder: "asc" }, { publishedAt: "desc" }], take: Math.max(12, 24 - boosted.length),
      });
      return { status: 200, data: [...boosted.map((l) => listingCard(l, base, "home")), ...rows.map((l) => listingCard(l, base))] };
    }));

  app.get<{ Params: { id: string } }>("/property-detail/:id", async (request) => {
    const id = z.coerce.number().int().positive().safeParse(request.params.id);
    if (!id.success) throw notFound("This property isn't available any more.");
    return showListing({ id: id.data }, request);
  });
  app.get<{ Params: { slug: string } }>("/property-by-slug/:slug", async (request) => showListing({ slug: request.params.slug.slice(0, 200) }, request));
  app.get<{ Params: { code: string } }>("/property-by-code/:code", async (request) => {
    const code = request.params.code.replace(/^#/, "").trim().toUpperCase().slice(0, 20);
    // Old codes (from before a business changed its prefix) still find the listing.
    return showListing(/^\d+$/.test(code) ? { OR: [{ id: Number(code) }, { code }] } : { OR: [{ code }, { oldCodes: { has: code } }] }, request);
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

  // Counts beside every choice in the search filters. Each list counts the listings that match all the other filters,
  // so choosing one option never makes the rest of its own list disappear.
  app.get("/search/facets", async (request) => {
    const q = searchQuery.partial().parse(request.query);
    return cached(app.cache, cacheKey("facets", q), LIST_TTL, async () => {
      const db = dbOf(app);
      const without = (k: keyof Search) => whereFor({ ...q, [k]: undefined });
      const [types, cats, beds, states, purposes] = await Promise.all([
        db.listing.groupBy({ by: ["propertyType"], where: without("property_type"), _count: { _all: true } }),
        db.listing.groupBy({ by: ["category"], where: without("category"), _count: { _all: true } }),
        db.listing.groupBy({ by: ["bedrooms"], where: without("bedrooms"), _count: { _all: true } }),
        db.listing.groupBy({ by: ["status"], where: without("property_status"), _count: { _all: true } }),
        db.listing.groupBy({ by: ["purpose"], where: without("advertisement_purpose"), _count: { _all: true } }),
      ]);
      const named = (rows: { name: string | null; n: number }[]) => rows.filter((r) => r.name).map((r) => ({ name: r.name as string, count: r.n })).sort((a, b) => b.count - a.count);
      const atLeast = (b: number) => beds.filter((r) => (r.bedrooms ?? 0) >= b).reduce((s, r) => s + r._count._all, 0);
      const st = (s: string) => states.find((r) => r.status === s)?._count._all ?? 0;
      const pu = (p: string) => purposes.find((r) => r.purpose === p)?._count._all ?? 0;
      return {
        status: 200,
        data: {
          property_type: named(types.map((r) => ({ name: r.propertyType, n: r._count._all }))),
          category: named(cats.map((r) => ({ name: r.category, n: r._count._all }))),
          bedrooms: Object.fromEntries([1, 2, 3, 4, 5].map((b) => [String(b), atLeast(b)])),
          property_status: { AVAILABLE: st("published"), "SOLD OUT": st("sold"), "RENTED OUT": st("rented") },
          purpose: { sale: pu("sale"), rent: pu("rent") },
        },
      };
    });
  });

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

  // Partners (the owner's rule, 27 Nov 2026): every business on a paid plan (Starter, Business or Pro, or a gift of paid software), of any
  // type (agencies, hotels, hosts, developers, sponsors), with its type and live listing count. Free businesses still post and show on
  // their listings, but are not listed as partners.
  app.get("/agent-list", async () =>
    cached(app.cache, "catalog:partners", LIST_TTL, async () => {
      const db = dbOf(app);
      const now = new Date();
      const free = SOFTWARE.filter((x) => x.free).flatMap((x) => x.apps);
      const [subs, gifts, oldPlans] = await Promise.all([
        db.subscription.findMany({ where: { appId: { notIn: free }, uninstalledAt: null, currentPeriodEnd: { gt: now } }, select: { tenantId: true, priceGrossPaisa: true } }),
        db.entitlementGrant.findMany({ where: { revokedAt: null, appId: { notIn: free }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { tenantId: true } }),
        db.tenant.findMany({ where: { billingMode: { not: "apps" }, plan: { price: { gt: 0 } } }, select: { id: true } }),
      ]);
      const paid = new Set([...subs.filter((x) => Number(x.priceGrossPaisa ?? 0) > 0).map((x) => x.tenantId), ...gifts.map((x) => x.tenantId), ...oldPlans.map((x) => x.id)]);
      const [partners, counts] = await Promise.all([
        db.tenant.findMany({ where: { id: { in: [...paid] }, status: { in: ["active", "trial"] } }, select: { id: true, type: true, name: true, city: true, email: true, phone: true, logoUrl: true, address: true, website: true, verifiedAt: true }, orderBy: { name: "asc" } }),
        db.listing.groupBy({ by: ["tenantId"], where: LIVE, _count: true }),
      ]);
      const n = new Map(counts.map((c) => [c.tenantId, c._count]));
      return { status: 200, data: partners.map((a) => ({ ...agencyJson({ ...a, listings: n.get(a.id) ?? 0 }), business_type: a.type })) };
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
// Names savePhoto gives out are base64url, so they can start with "_" or "-" (never a dot, and no slashes).
const SAFE_FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}\.(jpe?g|png|webp|gif)$/i;
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

export async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { area: string; size: string; file: string } }>("/media/:area/:size/:file", { config: { rateLimit: false } }, async (request, reply) => {
    const { area, size, file } = request.params;
    // banner: home page banners (domain/banners.ts), kept as sent; GIFs may move.
    if (area !== "property" && area !== "blog" && area !== "brand" && area !== "banner") throw notFound("Photo not found.");
    const dir = app.config.MEDIA_DIR;
    if (!dir || !SIZES.has(size) || !SAFE_FILE.test(file)) throw notFound("Photo not found.");
    const path = join(dir, area, size, file);
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
