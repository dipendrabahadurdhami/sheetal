// Home page banners on the website: what shows behind the title and search today, and counting views and clicks.
// Where it fits: the home page hero (website/frontend/src/pages/Home.jsx). Businesses book banners in Business →
// Promote; Sheetal checks the pictures (Admin → Promote). Rules are in backend-core/src/domain/banners.ts.
// Rules: only approved banners on their dates; bots don't count; rate limited per address.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cached } from "@sheetal/backend-core/lib/cache";
import { dbOf } from "@sheetal/platform/db/client";
import { isBotRequest } from "@sheetal/backend-core/lib/bots";
import { mediaBase, photoUrl } from "@sheetal/backend-core/lib/photos";
import { liveBanners } from "@sheetal/backend-core/domain/banners";
import { today } from "@sheetal/backend-core/domain/promote";

export async function bannerRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const media = mediaBase(app.config);
  const pic = (f: string) => `${media}/banner/main/${encodeURIComponent(f)}`;

  app.get("/banners", async () =>
    cached(app.cache, `banners:${today()}`, 60, async () => {
      const rows = await liveBanners(db());
      // Listing banners: the listing's photos (up to 5, shown as a grid), price and place, opening the listing on this site.
      const ids = rows.map((r) => r.listingId).filter((x): x is number => !!x);
      const listings = ids.length ? await db().listing.findMany({
        where: { id: { in: ids }, status: { in: ["published", "sold", "rented"] }, reviewHold: false },
        select: { id: true, slug: true, title: true, purpose: true, kind: true, price: true, pricePer: true, area: true, city: true, district: true, photos: { orderBy: { sort: "asc" }, take: 5, select: { file: true } } },
      }) : [];
      const L = new Map(listings.map((l) => [l.id, l]));
      // Business page banners (no pictures, no listing): the business's name, city, listing count and the covers of its newest listings.
      const pageIds = [...new Set(rows.filter((r) => !r.desktop && !r.listingId && r.tenantId).map((r) => r.tenantId!))];
      const pages = new Map(await Promise.all(pageIds.map(async (tid) => {
        const where = { tenantId: tid, status: "published" as const, reviewHold: false };
        const [t, n, covers] = await Promise.all([
          db().tenant.findUnique({ where: { id: tid }, select: { name: true, city: true } }),
          db().listing.count({ where }),
          db().listing.findMany({ where: { ...where, photos: { some: {} } }, orderBy: { updatedAt: "desc" }, take: 5, select: { photos: { orderBy: { sort: "asc" }, take: 1, select: { file: true } } } }),
        ]);
        return [tid, { name: t?.name ?? "", city: t?.city ?? "", count: n, photos: covers.map((c) => photoUrl(media, "main", c.photos[0]!.file)) }] as const;
      })));
      type Out = { id: string; title: string; button: string; sponsored: boolean; desktop: string | null; mobile: string | null; link: string; internal?: boolean; listing?: unknown };
      const data = rows.flatMap((b): Out[] => {
        const l = b.listingId ? L.get(b.listingId) : undefined;
        if (b.listingId && !l) return []; // the listing went offline: its banner waits
        const pg = !b.desktop && !b.listingId && b.tenantId ? pages.get(b.tenantId) : undefined;
        if (!b.desktop && !b.listingId) {
          if (!pg?.photos.length) return []; // nothing to show yet
          return [{ id: b.id, title: b.title, button: b.button, sponsored: b.source === "paid", desktop: null, mobile: null, link: `/site/${b.tenantId}`, internal: true,
            listing: { title: b.title || pg.name, place: [`${pg.count} ${pg.count === 1 ? "listing" : "listings"}`, pg.city].filter(Boolean).join(" · "), price: null, page: true, photos: pg.photos } }];
        }
        const base = { id: b.id, title: b.title, button: b.button, sponsored: b.source === "paid" };
        if (!l) return [{ ...base, desktop: pic(b.desktop), mobile: pic(b.mobile), link: b.link }];
        return [{ ...base, desktop: null, mobile: null, link: `/property/${l.slug}`, internal: true,
          listing: { id: l.id, title: l.title, purpose: l.purpose, kind: l.kind, price: l.price == null ? null : Number(l.price), price_per: l.pricePer,
            place: [...new Set([l.area, l.city].filter(Boolean))].join(", ") || l.district, photos: l.photos.map((p) => photoUrl(media, "main", p.file)) } }];
      });
      return { status: 200, data };
    }));

  const count = async (ids: string[], field: "views" | "clicks", headers: Record<string, unknown>) => {
    if (!ids.length || isBotRequest(headers as { "user-agent"?: string })) return;
    await db().banner.updateMany({ where: { id: { in: ids }, status: "approved" }, data: { [field]: { increment: 1 } } });
  };
  app.post("/banners/seen", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const b = z.object({ ids: z.array(z.string().max(40)).max(10) }).parse(request.body);
    await count([...new Set(b.ids)], "views", request.headers);
    return { status: 200 };
  });
  app.post("/banners/click", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const b = z.object({ id: z.string().max(40) }).parse(request.body);
    await count([b.id], "clicks", request.headers);
    return { status: 200 };
  });
}
