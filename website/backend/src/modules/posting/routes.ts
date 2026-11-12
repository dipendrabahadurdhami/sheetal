// Posting a listing from the website, the person's own listings, plans and upgrade requests.
// Where it fits: the website's Post property, My properties and Plans pages.
// How it works: a listing always belongs to a business (the person's own; anyone without one gets a free Starter
// business), lands in its head office, and waits for Sheetal's review (staff are notified).
// Rules: plan limits apply; photos are checked to be real images; upgrade requests go to Sheetal's team.

import { platformSettings } from "@sheetal/backend-core/domain/platform";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { STAFF_FOR, notifyStaff } from "@sheetal/platform/notify/index";
import { headOffice } from "@sheetal/backend-core/domain/branches";
import { AppError, badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import { requireUser, type SessionUser } from "@sheetal/backend-core/modules/auth/sessions";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { PERIODS, priceFor } from "@sheetal/backend-core/domain/plans";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";
import { COUNTED, listingCap } from "@sheetal/backend-core/domain/listings";
import { listingCard, mediaBase } from "../catalog/present.js";
import { savePhoto } from "@sheetal/backend-core/lib/photos";

const LIVE: Prisma.ListingWhereInput = { status: { in: ["published", "sold", "rented"] } };
const OPEN: Prisma.ListingWhereInput = { status: { in: COUNTED } };
const num = z.union([z.coerce.number().min(0), z.literal("").transform(() => undefined)]).optional();
const str = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const files = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is Buffer => Buffer.isBuffer(x));
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "property";

export async function postingRoutes(app: FastifyInstance) {
  const base = mediaBase(app.config);

  /** The workspace a person posts into; old-site accounts without one get a free Starter workspace. */
  async function workspaceFor(user: SessionUser) {
    const m = user.memberships.find((x) => x.status === "active" && hasPerm(x.role.perms, "listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish"));
    if (m) return { tenantId: m.tenantId, plan: m.tenant.plan };
    const db = dbOf(app);
    const { trialDays } = await platformSettings(db);
    const t = await db.$transaction((tx) => createWorkspace(tx, { ownerId: user.id, name: user.userName, type: "agency", email: user.email, phone: user.phone ?? undefined, trialDays }));
    return { tenantId: t.id, plan: (await db.plan.findUniqueOrThrow({ where: { id: t.planId } })) };
  }

  /** Same option lists the website's form shows (property-attributes), so ids from the form map to names. */
  async function optionNames() {
    const db = dbOf(app);
    const [types, facs] = await Promise.all([
      db.listing.groupBy({ by: ["propertyType"], where: { AND: [LIVE, { propertyType: { not: null } }] }, orderBy: { propertyType: "asc" } }),
      db.$queryRaw<{ f: string }[]>`SELECT DISTINCT unnest(facilities) AS f FROM listings WHERE status IN ('published','sold','rented') ORDER BY f`,
    ]);
    return { types: types.map((t) => t.propertyType!), facilities: facs.map((f) => f.f) };
  }

  app.post("/post-property", { bodyLimit: 100 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const user = requireUser(request);
    if (!user.emailVerifiedAt) throw new AppError(403, "verify_email", "Please verify your email address before posting.");
    const raw = (request.body ?? {}) as Record<string, unknown>;
    const pick = (k: string) => raw[k] ?? raw[`${k}[]`];
    const b = z.object({
      name: z.string().trim().min(8, "Write a title of at least 8 characters.").max(150),
      purpose_id: z.coerce.number().int(), propertytype_id: num, property_type: str(80), propertycategory: str(60),
      total_price: num, rent_per_month: num,
      bedrooms: num, bathrooms: num, kitchens: num, living_room: num, floors: num, parking: str(40), completion_year: str(10),
      land_area_in_anna_lal: num, land_area_in_ropani_lal: num, road_access: str(40), land_facing: str(30),
      property_location: str(150), district: z.string().trim().min(2, "Choose the district.").max(60), town: str(80), tol: str(120), ward_no: str(10),
      lat: num, lng: num,
      property_highlights: str(3000), property_description: str(20000), youtube_url: str(300),
      owner_name: str(80), owner_info: str(80), owner_email: str(120),
      facilities_id: z.array(z.coerce.number().int()).max(50).default([]),
    }).parse({ ...Object.fromEntries(Object.entries(raw).filter(([, v]) => !Buffer.isBuffer(v) && !Array.isArray(v))), facilities_id: [pick("facilities_id")].flat().filter((x) => x !== undefined && x !== "") });

    const cover = files(pick("feature_image"));
    const gallery = files(pick("gallery_images"));
    if (!cover.length) throw badRequest("Add a main photo.", { feature_image: ["Add a main photo."] });
    if (gallery.length > 20) throw badRequest("Up to 20 more photos.");

    const db = dbOf(app);
    const ws = await workspaceFor(user);
    const cap = listingCap(ws.plan);
    if (cap !== -1 && (await db.listing.count({ where: { tenantId: ws.tenantId, ...OPEN } })) >= cap) {
      throw new AppError(402, "listing_limit", cap === 1 ? "The free Starter plan has room for one listing. Mark it sold or upgrade to post more." : `Your plan has room for ${cap} listings. Upgrade to post more.`);
    }

    const opts = await optionNames();
    const rent = b.purpose_id === 2;
    const price = rent ? b.rent_per_month ?? b.total_price : b.total_price;
    const landParts = [b.land_area_in_ropani_lal ? `${b.land_area_in_ropani_lal} Ropani` : "", b.land_area_in_anna_lal ? `${b.land_area_in_anna_lal} Aana` : ""].filter(Boolean);
    const photos: string[] = [];
    for (const f of [...cover, ...gallery]) photos.push(await savePhoto(app.config.MEDIA_DIR, f));
    const ll = b.lat && b.lng && b.lat > 26 && b.lat < 31 && b.lng > 80 && b.lng < 89 ? { lat: b.lat, lng: b.lng } : {};
    const strip = (h?: string) => h?.replace(/<[^>]*>/g, "").trim() || undefined; // plain text from the website form

    const created = await db.$transaction(async (tx) => {
      const l = await tx.listing.create({ data: {
        code: `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, slug: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tenantId: ws.tenantId, branchId: await headOffice(db, ws.tenantId), userId: user.id, kind: rent ? "rentout" : "sell", purpose: rent ? "rent" : "sale",
        category: b.propertycategory ?? "House", propertyType: b.property_type ?? (b.propertytype_id ? opts.types[b.propertytype_id - 1] : undefined),
        title: b.name, description: strip(b.property_description), highlights: strip(b.property_highlights), status: "pending", submittedAt: new Date(),
        price: price ? BigInt(Math.round(price)) : null, pricePer: rent ? "month" : null,
        district: b.district, city: b.town, area: b.tol ?? b.property_location, ward: b.ward_no, ...ll,
        bedrooms: b.bedrooms, bathrooms: b.bathrooms, kitchens: b.kitchens, livingRooms: b.living_room, floors: b.floors, parking: b.parking,
        landArea: landParts.join(" ") || undefined, landSqft: (b.land_area_in_ropani_lal ?? 0) * 5476 + (b.land_area_in_anna_lal ?? 0) * 342.25 || undefined,
        roadAccess: b.road_access, facing: b.land_facing, builtYear: b.completion_year, youtubeUrl: b.youtube_url,
        facilities: b.facilities_id.map((i) => opts.facilities[i - 1]).filter((x): x is string => !!x),
        private: { owner: b.owner_name, owner_phone: b.owner_info, owner_email: b.owner_email },
        photos: { create: photos.map((file, sort) => ({ file, sort })) },
      } });
      return tx.listing.update({ where: { id: l.id }, data: { code: `SP-${String(l.id).padStart(4, "0")}`, slug: `${slugify(b.name)}-${l.id}` }, include: { photos: true } });
    });
    await notifyStaff(db, STAFF_FOR.listingReview, { type: "review", title: "Listing to review", message: `${created.title} · posted on the website`, link: "/admin/moderation" });
    return { status: 200, message: "Posted. Sheetal checks every listing before it goes live, usually within a day.", data: { ...listingCard(created, base), listing_status: created.status } };
  });

  app.get("/user-property", async (request) => {
    const user = requireUser(request);
    const rows = await dbOf(app).listing.findMany({ where: { userId: user.id, ...OPEN }, include: { photos: { orderBy: { sort: "asc" } } }, orderBy: { createdAt: "desc" } });
    return { status: 200, data: rows.map((l) => ({ ...listingCard(l, base), listing_status: l.status })) };
  });

  /** A listing this person may change: their own post, or one in a business where they manage listings. */
  async function ownListing(user: SessionUser, id: number) {
    const l = await dbOf(app).listing.findFirst({ where: { id, ...OPEN } });
    if (!l) throw notFound("Listing not found.");
    const manages = l.tenantId && user.memberships.some((m) => m.tenantId === l.tenantId && hasPerm(m.role.perms, "listings.listing.read+listings.listing.create+listings.listing.update+listings.listing.delete+listings.listing.publish"));
    if (l.userId !== user.id && !manages) throw forbidden("You can only change your own listings.");
    return l;
  }

  app.delete<{ Params: { id: string } }>("/delete-property/:id", async (request) => {
    const user = requireUser(request);
    const l = await ownListing(user, Number(request.params.id) || -1);
    // Kept (removed) so leads and history still point somewhere; it no longer shows anywhere.
    await dbOf(app).listing.update({ where: { id: l.id }, data: { status: "removed" } });
    await dbOf(app).auditLog.create({ data: { action: "listing.removed", actorId: user.id, tenantId: l.tenantId, target: l.code, ip: request.ip } });
    return { status: 200, message: "Deleted" };
  });

  app.post("/mark-as-sold", async (request) => {
    const user = requireUser(request);
    const b = z.object({ property_id: z.coerce.number().int().positive(), sold: z.union([z.boolean(), z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1")]).default(true) }).parse(request.body);
    const l = await ownListing(user, b.property_id);
    if (!["published", "sold", "rented"].includes(l.status)) throw badRequest("Only live listings can be marked sold or rented.");
    const status = b.sold ? (l.purpose === "rent" ? "rented" : "sold") : "published";
    await dbOf(app).listing.update({ where: { id: l.id }, data: { status } });
    return { status: 200, message: b.sold ? (status === "rented" ? "Marked as rented out." : "Marked as sold.") : "Available again." };
  });

  // ───── Plans and upgrades ─────
  app.get("/subscription-plans", async (request) => {
    const { type } = z.object({ type: z.enum(["agency", "hotel", "host", "developer", "sponsor"]).default("agency") }).parse(request.query);
    const plans = await dbOf(app).plan.findMany({ where: { type, active: true }, orderBy: { sort: "asc" } });
    return {
      status: 200,
      data: plans.map((p) => ({
        id: p.id, type: p.type, name: p.name, slug: p.name.toLowerCase(), price: p.price, limits: p.limits, features: p.features,
        periods: PERIODS.map((x) => ({ months: x.months, save: x.save, price: priceFor(p.price, x.months), saving: p.price * x.months - priceFor(p.price, x.months) })),
      })),
    };
  });

  app.post("/request-upgrade", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const user = requireUser(request);
    const b = z.object({ requested_plan: z.string().max(40), months: z.coerce.number().int().refine((m) => PERIODS.some((x) => x.months === m), "Choose 1, 3, 6 or 12 months.").default(1) }).parse(request.body);
    const db = dbOf(app);
    const plan = await db.plan.findUnique({ where: { id: b.requested_plan } });
    if (!plan || !plan.active || !plan.price) throw badRequest("Choose a paid plan.");
    const owner = user.memberships.find((m) => m.tenant.type === plan.type && hasPerm(m.role.perms, "workspace.billing.manage"));
    const tenantId = owner?.tenantId ?? (await workspaceFor(user)).tenantId;
    await db.upgradeRequest.create({ data: { tenantId, userId: user.id, planId: plan.id, months: b.months } });
    await app.mailer.send({
      to: app.config.SUPPORT_EMAIL, subject: `Upgrade request: ${plan.name} (${plan.type}) for ${b.months} months`,
      text: `${user.userName} <${user.email}>${user.phone ? `, ${user.phone}` : ""} asked for ${plan.name} (${plan.type}) for ${b.months} months: Rs. ${priceFor(plan.price, b.months).toLocaleString("en-IN")}.\nBusiness id: ${tenantId}`,
    });
    await notifyStaff(db, STAFF_FOR.businessRequests, { type: "upgrade", title: `Upgrade request: ${plan.name} (${plan.type})`, message: `${user.userName} · ${b.months} month${b.months > 1 ? "s" : ""}`, link: "/admin/requests" });
    return { status: 200, message: "Upgrade request sent. Our team will call you to finish it." };
  });
}
