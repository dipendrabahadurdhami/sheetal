import type { FastifyInstance } from "fastify";
import type { Listing, ListingPhoto, ListingStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { isPhotoName, mediaBase, photoUrl, savePhoto } from "@sheetal/backend-core/lib/photos";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";
import { COUNTED, LISTING_KINDS, LISTING_PERMS, kindsFor, listingCap, purposeOf } from "@sheetal/backend-core/domain/listings";
import { workspaceOf, type Workspace } from "../access.js";

// A business's listings in /business: list, add (from the listing wizard), edit, duplicate, pause, archive,
// delete and move to another business of the same person. Nothing goes live without Sheetal's review:
// a new or edited listing waits as "pending" until the admin review queue approves it (admin/backend).
//
// The wizard sends two things: `values`, its form exactly as filled in (kept in `private.form`, never shown on the
// website, so it can be opened again for editing), and `summary`, the readable fields the website shows.

const LIVE: ListingStatus[] = ["published", "sold", "rented"];
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "property";
const tmp = () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const n = z.coerce.number().min(0).max(1e13).optional().nullable().transform((v) => v ?? undefined);
const int = z.coerce.number().int().min(0).max(1000).optional().nullable().transform((v) => v ?? undefined);
const str = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || undefined);

const Summary = z.object({
  title: z.string().trim().max(150).default(""),
  category: str(60), propertyType: str(80),
  price: n, pricePer: z.enum(["month", "night", "total"]).optional().nullable().transform((v) => v ?? undefined), negotiable: z.boolean().optional(),
  province: str(60), district: str(60), city: str(80), area: str(120), street: str(120), ward: str(10),
  lat: z.coerce.number().min(26).max(31).optional().nullable().transform((v) => v ?? undefined),
  lng: z.coerce.number().min(80).max(89).optional().nullable().transform((v) => v ?? undefined),
  bedrooms: int, bathrooms: int, kitchens: int, livingRooms: int, floors: n, parking: str(40),
  landArea: str(80), landSqft: n, builtArea: str(80), roadAccess: str(40), roadType: str(40), facing: str(30), builtYear: str(10), furnishing: str(40),
  facilities: z.array(z.string().trim().max(60)).max(80).default([]),
  description: str(20000), highlights: str(3000), youtubeUrl: z.string().trim().url().max(300).optional().nullable().or(z.literal("")).transform((v) => v || undefined),
  // Public extras the website may show (room types, unit types, house rules…). Small, plain values only.
  details: z.record(z.string().max(40), z.unknown()).default({}).refine((d) => JSON.stringify(d).length <= 20_000, "Too many details."),
  photos: z.array(z.string().refine(isPhotoName, "Unknown photo.")).max(40).default([]),
});
type SummaryIn = z.infer<typeof Summary>;

const Body = z.object({
  kind: z.enum(LISTING_KINDS),
  values: z.record(z.string(), z.unknown()).default({}).refine((v) => JSON.stringify(v).length <= 200_000, "The form is too large."),
  summary: Summary,
  /** true = send for review; false = keep as a draft. */
  submit: z.boolean().default(true),
});

type Row = Listing & { photos: ListingPhoto[] };

export async function listingRoutes(app: FastifyInstance) {
  const base = mediaBase(app.config);
  const db = () => dbOf(app);

  function canList(ws: Workspace) {
    if (!LISTING_PERMS.some(ws.can)) throw forbidden("Your role can't manage listings.");
  }
  const audit = (ws: Workspace, ip: string, action: string, target: string, tenantId = ws.tenantId, meta?: object) =>
    db().auditLog.create({ data: { actorId: ws.user.id, tenantId, action, target, ip, meta: meta as object | undefined } });

  /** The listing, if it belongs to the open business and isn't removed. */
  async function own(ws: Workspace, code: string) {
    const l = await db().listing.findFirst({ where: { code, tenantId: ws.tenantId, status: { not: "removed" } }, include: { photos: { orderBy: { sort: "asc" } } } });
    if (!l) throw notFound("Listing not found.");
    return l;
  }

  async function checkRoom(tenantId: string, plan: Workspace["member"]["tenant"]["plan"], adding = 1) {
    const cap = listingCap(plan);
    if (cap === -1) return;
    const used = await db().listing.count({ where: { tenantId, status: { in: COUNTED } } });
    if (used + adding > cap) {
      throw new AppError(402, "listing_limit", cap === 1 ? "The free Starter plan has room for one listing. Archive one or upgrade to add more." : `Your plan has room for ${cap} listings. Archive some or upgrade to add more.`);
    }
  }

  function checkSubmit(s: SummaryIn) {
    const errors: Record<string, string[]> = {};
    if (s.title.length < 8) errors.title = ["Write a title of at least 8 characters."];
    if (!s.district) errors.location = ["Choose the district."];
    if (!s.photos.length) errors.photos = ["Add at least one photo."];
    if (Object.keys(errors).length) throw badRequest("A few things are missing before Sheetal can check it.", errors);
  }

  /** Columns from the wizard's summary. */
  const columns = (kind: string, s: SummaryIn): Prisma.ListingUncheckedUpdateInput => ({
    kind, purpose: purposeOf(kind), title: s.title || "Untitled listing", category: s.category ?? "House", propertyType: s.propertyType ?? null,
    price: s.price ? BigInt(Math.round(s.price)) : null, pricePer: s.pricePer ?? (kind === "rentout" ? "month" : kind.startsWith("stay_") ? "night" : null), negotiable: !!s.negotiable,
    province: s.province ?? null, district: s.district ?? null, city: s.city ?? null, area: s.area ?? null, street: s.street ?? null, ward: s.ward ?? null,
    lat: s.lat ?? null, lng: s.lng ?? null,
    bedrooms: s.bedrooms ?? null, bathrooms: s.bathrooms ?? null, kitchens: s.kitchens ?? null, livingRooms: s.livingRooms ?? null, floors: s.floors ?? null, parking: s.parking ?? null,
    landArea: s.landArea ?? null, landSqft: s.landSqft ?? null, builtArea: s.builtArea ?? null, roadAccess: s.roadAccess ?? null, roadType: s.roadType ?? null,
    facing: s.facing ?? null, builtYear: s.builtYear ?? null, furnishing: s.furnishing ?? null, facilities: s.facilities,
    description: s.description ?? null, highlights: s.highlights ?? null, youtubeUrl: s.youtubeUrl ?? null, details: s.details as Prisma.InputJsonValue,
  });

  const priv = (l: Listing) => (l.private ?? {}) as Record<string, unknown>;

  /** A row for the listings table (same shape the panel already uses). */
  const row = (l: Row, leads: number) => ({
    id: l.code, tenantId: l.tenantId, kind: l.kind, title: l.title,
    // The panel calls Sheetal's check "in review".
    status: l.status === "pending" ? "in_review" : l.status,
    price: l.price == null ? 0 : Number(l.price), views: l.views, leads, updated: day(l.updatedAt),
    issues: l.status === "rejected" && l.reviewNote ? [l.reviewNote] : undefined,
    cover: l.photos[0] ? photoUrl(base, "thumbnail", l.photos[0].file) : null,
    link: LIVE.includes(l.status) ? `/property/${l.slug}` : null,
    checkDue: day(l.checkDueAt), lastChecked: day(l.lastCheckedAt),
  });

  /** The wizard's form for editing. Listings that never went through the wizard (imported) get one from their columns. */
  function formOf(l: Row): Record<string, unknown> {
    const saved = priv(l).form;
    const photos = l.photos.map((p) => ({ id: p.file, file: p.file, url: photoUrl(base, "main", p.file) }));
    if (saved && typeof saved === "object") return { ...(saved as object), photos };
    const price = l.price == null ? undefined : Number(l.price);
    return {
      title: l.title, category: l.category.toLowerCase(), propertyType: l.propertyType ?? undefined,
      ...(l.kind === "rentout" ? { rent: price } : l.kind === "stay_unit" ? { nightly: price } : l.kind === "invest" ? { target: price } : { price }),
      negotiable: l.negotiable, location: l.district ? { district: l.district, custom: true, area: l.area ?? undefined } : undefined,
      ward: l.ward ? Number(l.ward) || undefined : undefined, tole: l.street ?? undefined,
      pin: l.lat && l.lng ? { lat: l.lat, lng: l.lng } : undefined,
      bedrooms: l.bedrooms ?? undefined, bathrooms: l.bathrooms ?? undefined, kitchens: l.kitchens ?? undefined, living: l.livingRooms ?? undefined, floors: l.floors ?? undefined,
      video: l.youtubeUrl ?? undefined, story: l.description ?? undefined, photos,
    };
  }

  const leadCounts = async (tenantId: string, ids: number[]) => {
    const g = await db().lead.groupBy({ by: ["listingId"], where: { tenantId, listingId: { in: ids } }, _count: true });
    return new Map(g.map((x) => [x.listingId, x._count]));
  };

  // ───── Read ─────
  // Two shapes: with ?page, one page of the listings table (search, kind and status filters, counts per status);
  // without it, a short summary of every listing for the screens that work across all of them (check-ups, search, menus).
  app.get("/listings", async (request) => {
    const ws = workspaceOf(request);
    if (!LISTING_PERMS.some(ws.can) && !ws.can("overview.view")) throw forbidden("Your role can't see listings.");
    const q = z.object({
      page: z.coerce.number().int().min(1).optional(), per: z.coerce.number().int().min(10).max(500).default(100),
      q: z.string().trim().max(80).optional(), kind: z.enum(LISTING_KINDS).optional(),
      status: z.enum(["all", "published", "in_review", "draft", "paused", "rejected", "sold", "rented", "archived"]).default("all"),
    }).parse(request.query);
    const plan = ws.member.tenant.plan;
    const base: Prisma.ListingWhereInput = { tenantId: ws.tenantId, status: { not: "removed" } };
    const [byStatus, byKind] = await Promise.all([
      db().listing.groupBy({ by: ["status"], where: base, _count: true }),
      db().listing.groupBy({ by: ["kind"], where: base, _count: true }),
    ]);
    const counts: Record<string, number> = Object.fromEntries(byStatus.map((g) => [g.status === "pending" ? "in_review" : g.status, g._count]));
    counts.all = byStatus.filter((g) => g.status !== "archived").reduce((a, g) => a + g._count, 0);
    const meta = {
      cap: listingCap(plan), used: byStatus.filter((g) => COUNTED.includes(g.status)).reduce((a, g) => a + g._count, 0),
      kinds: kindsFor(ws.member.tenant.type, plan), listedKinds: byKind.map((g) => g.kind), counts,
    };

    if (!q.page) {
      const rows = await db().listing.findMany({
        where: base, orderBy: { updatedAt: "desc" },
        select: { code: true, tenantId: true, kind: true, title: true, status: true, price: true, updatedAt: true, checkDueAt: true, lastCheckedAt: true },
      });
      return {
        data: rows.map((l) => ({
          id: l.code, tenantId: l.tenantId, kind: l.kind, title: l.title, status: l.status === "pending" ? "in_review" : l.status,
          price: l.price == null ? 0 : Number(l.price), updated: day(l.updatedAt), checkDue: day(l.checkDueAt), lastChecked: day(l.lastCheckedAt),
        })),
        meta,
      };
    }

    const where: Prisma.ListingWhereInput = {
      ...base,
      ...(q.status === "all" ? { status: { notIn: ["removed", "archived"] } } : { status: q.status === "in_review" ? "pending" : q.status }),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { code: { equals: q.q.toUpperCase() } }, { area: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      db().listing.count({ where }),
      db().listing.findMany({ where, include: { photos: { orderBy: { sort: "asc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, skip: (q.page - 1) * q.per, take: q.per }),
    ]);
    const leads = await leadCounts(ws.tenantId, rows.map((r) => r.id));
    return {
      data: rows.map((l) => row(l, leads.get(l.id) ?? 0)),
      meta: { ...meta, total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / q.per)), per_page: q.per },
    };
  });

  app.get<{ Params: { code: string } }>("/listings/:code", async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const l = await own(ws, request.params.code);
    const leads = await leadCounts(ws.tenantId, [l.id]);
    return { data: { ...row(l, leads.get(l.id) ?? 0), values: formOf(l), reviewNote: l.reviewNote } };
  });

  // ───── Photos (uploaded one by one as they are picked, then listed by name in the summary) ─────
  app.post("/listing-photos", { bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 120, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const { data } = z.object({ data: z.string().min(16).max(11 * 1024 * 1024) }).parse(request.body);
    const file = await savePhoto(app.config.MEDIA_DIR, Buffer.from(data, "base64"));
    return { data: { file, url: photoUrl(base, "main", file), thumbnail: photoUrl(base, "thumbnail", file) } };
  });

  // ───── Add and edit ─────
  app.post("/listings", { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const b = Body.parse(request.body);
    const t = ws.member.tenant;
    if (!kindsFor(t.type, t.plan).includes(b.kind)) throw forbidden("This business can't list that kind of property on its plan.");
    if (b.submit) checkSubmit(b.summary);
    await checkRoom(ws.tenantId, t.plan);
    const { photos, ...summary } = b.summary;
    const created = await db().$transaction(async (tx) => {
      const l = await tx.listing.create({ data: {
        ...(columns(b.kind, { ...summary, photos }) as Prisma.ListingUncheckedCreateInput),
        code: tmp(), slug: tmp(), tenantId: ws.tenantId, userId: ws.user.id,
        status: b.submit ? "pending" : "draft", submittedAt: b.submit ? new Date() : null,
        private: { form: { ...b.values, photos: undefined } } as Prisma.InputJsonValue,
        photos: { create: photos.map((file, sort) => ({ file, sort })) },
      } });
      return tx.listing.update({ where: { id: l.id }, data: { code: `SP-${String(l.id).padStart(4, "0")}`, slug: `${slugify(l.title)}-${l.id}` }, include: { photos: true } });
    });
    await audit(ws, request.ip, b.submit ? "listing.submitted" : "listing.draft_saved", created.code);
    return {
      message: b.submit ? "Sent to Sheetal for review. It goes live once checked, usually within a day." : "Saved as a draft.",
      data: row(created, 0),
    };
  });

  app.patch<{ Params: { code: string } }>("/listings/:code", async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const l = await own(ws, request.params.code);
    const b = Body.parse(request.body);
    const t = ws.member.tenant;
    if (b.kind !== l.kind && !kindsFor(t.type, t.plan).includes(b.kind)) throw forbidden("This business can't list that kind of property on its plan.");
    // What the website shows never changes without a check: edits to a live or paused listing must be sent for review.
    if (!b.submit && (LIVE.includes(l.status) || l.status === "paused")) throw badRequest("Send the changes to Sheetal for review; a live listing can't change without a check.");
    if (b.submit) checkSubmit(b.summary);
    if (["archived", "rejected"].includes(l.status) && b.submit) await checkRoom(ws.tenantId, t.plan);
    // Any change to what the website shows is checked again; a draft stays a draft until it is sent.
    const status: ListingStatus = b.submit ? "pending" : l.status === "draft" ? "draft" : l.status;
    const { photos, ...summary } = b.summary;
    const updated = await db().$transaction(async (tx) => {
      await tx.listingPhoto.deleteMany({ where: { listingId: l.id } });
      return tx.listing.update({
        where: { id: l.id },
        data: {
          ...columns(b.kind, { ...summary, photos }), status, submittedAt: b.submit ? new Date() : l.submittedAt,
          reviewNote: b.submit ? null : l.reviewNote,
          private: { ...priv(l), form: { ...b.values, photos: undefined } } as Prisma.InputJsonValue,
          photos: { create: photos.map((file, sort) => ({ file, sort })) },
        },
        include: { photos: true },
      });
    });
    await audit(ws, request.ip, b.submit ? "listing.submitted" : "listing.updated", l.code);
    const leads = await leadCounts(ws.tenantId, [l.id]);
    return {
      message: b.submit ? (LIVE.includes(l.status) ? "Changes sent for review. The listing is off the website until Sheetal checks them." : "Sent to Sheetal for review.") : "Saved.",
      data: row(updated, leads.get(l.id) ?? 0),
    };
  });

  // ───── Status: publish, pause, archive (one or many) ─────
  app.post("/listings/status", async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const b = z.object({ ids: z.array(z.string().max(20)).min(1).max(500), status: z.enum(["published", "paused", "archived", "available", "sold"]) }).parse(request.body);
    const rows = await db().listing.findMany({ where: { code: { in: b.ids }, tenantId: ws.tenantId, status: { not: "removed" } }, include: { photos: { take: 1 } } });
    if (!rows.length) throw notFound("Listing not found.");
    const plan = ws.member.tenant.plan;
    const reviewing: string[] = [];
    const changed: string[] = [];
    for (const l of rows) {
      let next: ListingStatus | null = null;
      if (b.status === "paused") next = LIVE.includes(l.status) ? "paused" : null;
      else if (b.status === "archived") next = "archived";
      else if (b.status === "sold") next = LIVE.includes(l.status) ? (l.purpose === "rent" ? "rented" : "sold") : null;
      else if (b.status === "available") next = l.status === "sold" || l.status === "rented" ? "published" : null;
      else {
        // Publish: a listing Sheetal approved before goes straight back; anything else is sent for review.
        if (l.status === "pending" || LIVE.includes(l.status)) continue;
        if (l.status === "archived") await checkRoom(ws.tenantId, plan);
        const approved = !!l.publishedAt && l.status !== "rejected" && l.status !== "draft";
        if (!approved && !l.photos.length) throw badRequest(`Add a photo to "${l.title}" before sending it for review.`);
        next = approved ? "published" : "pending";
        if (next === "pending") reviewing.push(l.code);
      }
      if (!next || next === l.status) continue;
      await db().listing.update({ where: { id: l.id }, data: { status: next, ...(next === "pending" ? { submittedAt: new Date() } : {}) } });
      changed.push(l.code);
    }
    if (changed.length) await audit(ws, request.ip, `listing.${b.status}`, changed.join(", "));
    const word = { published: "Published", paused: "Paused. Hidden from the website until you publish again.", archived: "Archived", sold: "Marked sold", available: "Available again" }[b.status];
    return { message: reviewing.length ? `${reviewing.length === changed.length ? "Sent" : `${changed.length - reviewing.length} published, ${reviewing.length} sent`} to Sheetal for review.` : changed.length ? word : "Nothing to change.", data: { changed } };
  });

  app.post<{ Params: { code: string } }>("/listings/:code/duplicate", async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const l = await own(ws, request.params.code);
    await checkRoom(ws.tenantId, ws.member.tenant.plan);
    const copy = await db().$transaction(async (tx) => {
      const { id: _id, code: _c, slug: _s, createdAt: _a, updatedAt: _u, photos, ...rest } = l;
      const c = await tx.listing.create({ data: {
        ...rest, details: rest.details as Prisma.InputJsonValue, private: rest.private as Prisma.InputJsonValue, suggest: undefined,
        code: tmp(), slug: tmp(), title: `${l.title} (copy)`.slice(0, 150), status: "draft", userId: ws.user.id, views: 0, featured: false,
        legacyId: null, publishedAt: null, submittedAt: null, reviewedAt: null, reviewedBy: null, reviewNote: null, lastCheckedAt: null, lastCheckedBy: null, checkDueAt: null,
        photos: { create: photos.map((p) => ({ file: p.file, sort: p.sort })) },
      } });
      return tx.listing.update({ where: { id: c.id }, data: { code: `SP-${String(c.id).padStart(4, "0")}`, slug: `${slugify(c.title)}-${c.id}` }, include: { photos: true } });
    });
    await audit(ws, request.ip, "listing.duplicated", copy.code, ws.tenantId, { from: l.code });
    return { message: "Copy saved as a draft.", data: row(copy, 0) };
  });

  app.post("/listings/delete", async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const { ids } = z.object({ ids: z.array(z.string().max(20)).min(1).max(500) }).parse(request.body);
    // Kept as "removed" so leads and history still point somewhere; it no longer shows anywhere.
    const r = await db().listing.updateMany({ where: { code: { in: ids }, tenantId: ws.tenantId, status: { not: "removed" } }, data: { status: "removed", featured: false } });
    if (!r.count) throw notFound("Listing not found.");
    await audit(ws, request.ip, "listing.removed", ids.join(", "));
    return { message: r.count > 1 ? `${r.count} listings deleted.` : "Listing deleted." };
  });

  // ───── Move to another business of the same person ─────
  /** Businesses this person can move the listing into: they manage listings there, and its plan allows the kind. */
  app.get<{ Params: { code: string } }>("/listings/:code/move-targets", async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const l = await own(ws, request.params.code);
    return {
      data: ws.user.memberships
        .filter((m) => m.tenantId !== ws.tenantId && m.status === "active" && LISTING_PERMS.some((p) => hasPerm(m.role.perms, p)))
        .map((m) => ({ id: m.tenantId, name: m.tenant.name, type: m.tenant.type, plan: m.tenant.plan.name, allowed: kindsFor(m.tenant.type, m.tenant.plan).includes(l.kind as never) })),
    };
  });

  app.post<{ Params: { code: string } }>("/listings/:code/move", async (request) => {
    const ws = workspaceOf(request);
    canList(ws);
    const l = await own(ws, request.params.code);
    const { tenantId } = z.object({ tenantId: z.string().min(1).max(40) }).parse(request.body);
    if (tenantId === ws.tenantId) throw badRequest("It's already in this business.");
    const target = ws.user.memberships.find((m) => m.tenantId === tenantId && m.status === "active");
    if (!target || !LISTING_PERMS.some((p) => hasPerm(target.role.perms, p))) throw forbidden("You can only move listings into a business where you manage listings.");
    if (target.tenant.status === "suspended" || target.tenant.status === "cancelled") throw badRequest("That business isn't active.");
    if (!kindsFor(target.tenant.type, target.tenant.plan).includes(l.kind as never)) throw badRequest(`${target.tenant.name} can't list this kind of property on its plan.`);
    if (COUNTED.includes(l.status)) await checkRoom(tenantId, target.tenant.plan);
    await db().$transaction([
      db().listing.update({ where: { id: l.id }, data: { tenantId } }),
      // Its enquiries go with it, so the new business can follow them up.
      db().lead.updateMany({ where: { listingId: l.id, tenantId: ws.tenantId }, data: { tenantId, assigneeId: null } }),
    ]);
    await audit(ws, request.ip, "listing.moved_out", l.code, ws.tenantId, { to: tenantId });
    await audit(ws, request.ip, "listing.moved_in", l.code, tenantId, { from: ws.tenantId });
    return { message: `Moved to ${target.tenant.name}.` };
  });
}
