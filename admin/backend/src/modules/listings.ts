import type { FastifyInstance } from "fastify";
import type { ListingStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, notFound } from "@sheetal/backend-core/lib/errors";
import { mediaBase, photoUrl } from "@sheetal/backend-core/lib/photos";
import { FIRST_CHECKUP_DAYS } from "@sheetal/backend-core/domain/listings";
import { staffOf } from "./routes.js";

// The review queue: every listing a business (or a website poster) sends goes live only after a Sheetal moderator
// approves it. "Needs changes" sends it back with a note the business sees on the listing. Both are emailed.

const STATUSES = ["pending", "published", "rejected", "paused", "draft", "sold", "rented", "archived"] as const;

export async function adminListingRoutes(app: FastifyInstance) {
  const base = mediaBase(app.config);
  const db = () => dbOf(app);

  app.get("/admin/listings", async (request) => {
    staffOf(request, "moderation.listings");
    const q = z.object({
      status: z.enum(STATUSES).default("pending"), q: z.string().trim().max(80).optional(), tenantId: z.string().max(40).optional(),
      page: z.coerce.number().int().min(1).default(1),
    }).parse(request.query);
    const where: Prisma.ListingWhereInput = {
      status: q.status as ListingStatus, ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" } }, { code: { equals: q.q.toUpperCase() } }, { district: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const per = 30;
    // The oldest waiting first, so nothing sits in the queue for long.
    const orderBy: Prisma.ListingOrderByWithRelationInput[] = q.status === "pending" ? [{ submittedAt: "asc" }, { id: "asc" }] : [{ updatedAt: "desc" }];
    const [total, rows, waiting] = await Promise.all([
      db().listing.count({ where }),
      db().listing.findMany({ where, include: { photos: { orderBy: { sort: "asc" }, take: 1 } }, orderBy, skip: (q.page - 1) * per, take: per }),
      db().listing.count({ where: { status: "pending" } }),
    ]);
    const [tenants, users] = await Promise.all([
      db().tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId).filter((x): x is string => !!x) } }, select: { id: true, name: true, type: true, plan: { select: { name: true } } } }),
      db().user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, userName: true, email: true } }),
    ]);
    const t = new Map(tenants.map((x) => [x.id, x]));
    const u = new Map(users.map((x) => [x.id, x]));
    return {
      data: rows.map((l) => ({
        id: l.id, code: l.code, title: l.title, kind: l.kind, purpose: l.purpose, category: l.category, status: l.status,
        price: l.price == null ? null : Number(l.price), pricePer: l.pricePer, district: l.district, area: l.area,
        cover: l.photos[0] ? photoUrl(base, "thumbnail", l.photos[0].file) : null,
        tenant: l.tenantId ? t.get(l.tenantId) ?? null : null, poster: l.userId ? u.get(l.userId) ?? null : null,
        submittedAt: l.submittedAt ?? l.createdAt, reviewedAt: l.reviewedAt, reviewNote: l.reviewNote, updatedAt: l.updatedAt,
      })),
      meta: { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / per)), per_page: per, waiting },
    };
  });

  /** Everything a moderator checks, including the private owner details and papers the business entered. */
  app.get<{ Params: { id: string } }>("/admin/listings/:id", async (request) => {
    staffOf(request, "moderation.listings");
    const l = await db().listing.findUnique({ where: { id: Number(request.params.id) || -1 }, include: { photos: { orderBy: { sort: "asc" } } } });
    if (!l) throw notFound("Listing not found.");
    const [tenant, poster, history] = await Promise.all([
      l.tenantId ? db().tenant.findUnique({ where: { id: l.tenantId }, select: { id: true, name: true, type: true, email: true, phone: true, status: true, plan: { select: { name: true } } } }) : null,
      l.userId ? db().user.findUnique({ where: { id: l.userId }, select: { id: true, userName: true, email: true, phone: true } }) : null,
      db().auditLog.findMany({ where: { target: { contains: l.code } }, orderBy: { createdAt: "desc" }, take: 20, select: { action: true, createdAt: true, meta: true } }),
    ]);
    const { private: priv, photos, price, suggest: _s, ...rest } = l;
    const p = (priv ?? {}) as Record<string, unknown>;
    const form = (p.form ?? {}) as Record<string, unknown>;
    return {
      data: {
        ...rest, price: price == null ? null : Number(price),
        photos: photos.map((x) => ({ main: photoUrl(base, "main", x.file), thumbnail: photoUrl(base, "thumbnail", x.file) })),
        owner: { name: p.owner ?? null, phone: p.owner_phone ?? null, email: p.owner_email ?? null }, papers: form.docs ?? null,
        tenant, poster, history,
      },
    };
  });

  app.post<{ Params: { id: string } }>("/admin/listings/:id/review", async (request) => {
    const s = staffOf(request, "moderation.listings");
    const b = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() }).parse(request.body);
    if (b.decision === "reject" && !b.note) throw badRequest("Say what needs to change, so the business can fix it.", { note: ["Say what needs to change."] });
    const l = await db().listing.findUnique({ where: { id: Number(request.params.id) || -1 } });
    if (!l) throw notFound("Listing not found.");
    if (l.status !== "pending") throw badRequest("This listing isn't waiting for review any more.");
    const now = new Date();
    await db().listing.update({
      where: { id: l.id },
      data: b.decision === "approve"
        ? { status: "published", publishedAt: l.publishedAt ?? now, reviewedAt: now, reviewedBy: s.user.id, reviewNote: null, checkDueAt: l.checkDueAt ?? new Date(now.getTime() + FIRST_CHECKUP_DAYS * 864e5) }
        : { status: "rejected", reviewedAt: now, reviewedBy: s.user.id, reviewNote: b.note },
    });
    await db().auditLog.create({ data: { actorId: s.user.id, tenantId: l.tenantId, action: b.decision === "approve" ? "listing.approved" : "listing.rejected", target: l.code, ip: request.ip, meta: b.note ? { note: b.note } : undefined } });

    // Tell the business (its email) and the person who sent it.
    const [tenant, poster] = await Promise.all([
      l.tenantId ? db().tenant.findUnique({ where: { id: l.tenantId }, select: { email: true, name: true } }) : null,
      l.userId ? db().user.findUnique({ where: { id: l.userId }, select: { email: true, userName: true } }) : null,
    ]);
    const to = [...new Set([tenant?.email, poster?.email].filter((x): x is string => !!x).map((x) => x.toLowerCase()))];
    const site = app.config.SITE_URL.replace(/\/$/, "");
    const hello = `Namaste ${poster?.userName ?? tenant?.name ?? ""},\n\n`;
    const text = b.decision === "approve"
      ? `${hello}"${l.title}" (${l.code}) is now live on Sheetal Property:\n${site}/property/${l.slug}\n\nSheetal Property`
      : `${hello}"${l.title}" (${l.code}) needs a few changes before it can go live:\n\n${b.note}\n\nEdit it in your business panel and send it again:\n${site}/business/listings\n\nSheetal Property`;
    const subject = b.decision === "approve" ? `Your listing is live: ${l.title}` : `Changes needed: ${l.title}`;
    for (const addr of to) await app.mailer.send({ to: addr, subject, text });
    return { message: b.decision === "approve" ? "Approved. It's live on the website." : "Sent back with your note." };
  });
}
