// The public API for a business's developer: /v1/public/* with "Authorization: Bearer sk_live_…".
// Where it fits: keys are made in Business → Website and API (business/backend/src/modules/devkeys); this is what they open.
// How it works: GET /public/listings (the business's published listings, paged; scope listings.read), POST
// /public/leads (puts an enquiry of kind "api" in the business's Inbox; scope leads.write) and GET /public/bookings
// (stays of the business, without contact details; scope bookings.read). The key is found by its SHA-256, must not be
// revoked, belong to a business whose plan is running, and have the scope the route needs. lastUsedAt is updated at most
// once a minute.
// Rules: 60 requests a minute per key; a key only ever reaches its own business; answers carry public listing data only
// and never a guest's phone, email or notes; bad or missing keys all get the same 401.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, badRequest, forbidden } from "@sheetal/backend-core/lib/errors";
import { sha256 } from "@sheetal/backend-core/lib/secrets";
import { leadPeople, notify } from "@sheetal/backend-core/lib/notify";
import { headOffice } from "@sheetal/backend-core/domain/branches";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { listingCard, mediaBase } from "../catalog/present.js";

const RUNNING = ["active", "trial", "past_due"];
const Paging = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1), per: z.coerce.number().int().min(1).max(50).default(20) });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// One bucket per key (or per address when there is no key), so a busy key can't slow another.
const limit = { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => `pub:${sha256(String(r.headers.authorization ?? r.ip))}` } };

export async function publicApiRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const base = mediaBase(app.config);

  /** The key behind the request, or 401; 403 when it lacks the scope. */
  const keyOf = async (request: FastifyRequest, scope: string) => {
    const m = /^Bearer (sk_live_[A-Za-z0-9_-]{20,80})$/.exec(String(request.headers.authorization ?? ""));
    const key = m ? await db().apiKey.findUnique({ where: { hash: sha256(m[1]!) } }) : null;
    const tenant = key ? await db().tenant.findUnique({ where: { id: key.tenantId }, select: { status: true } }) : null;
    if (!key || key.revokedAt || !tenant || !RUNNING.includes(tenant.status)) throw new AppError(401, "unauthorized", "Send a valid key: Authorization: Bearer sk_live_…");
    if (!key.scopes.includes(scope)) throw forbidden(`This key can't do that. It needs the ${scope} scope.`);
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) await db().apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return key;
  };

  app.get("/public/listings", { config: limit }, async (request) => {
    const key = await keyOf(request, "listings.read");
    const q = Paging.parse(request.query);
    const where = { tenantId: key.tenantId, status: "published" as const };
    const [total, rows] = await Promise.all([
      db().listing.count({ where }),
      db().listing.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.per, take: q.per, include: { photos: { orderBy: { sort: "asc" }, take: 1 } } }),
    ]);
    return { data: rows.map((l) => listingCard(l, base)), meta: { page: q.page, per: q.per, total } };
  });

  app.post("/public/leads", { config: limit }, async (request) => {
    const key = await keyOf(request, "leads.write");
    const b = z.object({
      name: z.string().trim().min(2, "Add a name.").max(120),
      email: z.union([z.email("Enter a valid email address."), z.literal("")]).optional(),
      phone: z.string().trim().max(30).optional(),
      message: z.string().trim().min(2, "Add a message.").max(2000),
      listing_code: z.string().trim().max(20).optional(),
    }).parse(request.body);
    if (!b.email && !b.phone) throw badRequest("Add a phone number or an email so the business can reach them.", { phone: ["Add a phone number or an email."] });
    const code = b.listing_code?.replace(/^#/, "").toUpperCase();
    const listing = code ? await db().listing.findFirst({ where: { tenantId: key.tenantId, OR: [{ code }, { oldCodes: { has: code } }] }, select: { id: true, branchId: true } }) : null;
    if (code && !listing) throw badRequest("That listing code isn't one of this business's listings.");
    const branchId = listing?.branchId ?? (await headOffice(db(), key.tenantId));
    const lead = await db().lead.create({ data: { tenantId: key.tenantId, branchId, listingId: listing?.id, kind: "api", name: b.name, email: b.email || null, phone: b.phone || null, message: b.message, details: { channel: "api", key: key.name } } });
    await notify(db(), await leadPeople(db(), key.tenantId, branchId), { tenantId: key.tenantId, type: "lead", title: `New enquiry from ${b.name}`, message: b.message.slice(0, 140), link: "/business/inbox" });
    return { status: 201, message: "Enquiry received.", data: { id: lead.id } };
  });

  app.get("/public/bookings", { config: limit }, async (request) => {
    const key = await keyOf(request, "bookings.read");
    const q = Paging.extend({ from: Day.optional(), to: Day.optional(), status: z.string().trim().max(20).optional() }).parse(request.query);
    const range = { ...(q.from ? { gte: dayOf(q.from) } : {}), ...(q.to ? { lte: dayOf(q.to) } : {}) };
    if ([q.from, q.to].some((d) => d && Number.isNaN(dayOf(d).getTime()))) throw badRequest("That date isn't valid.");
    const where = { tenantId: key.tenantId, ...(q.status ? { status: q.status } : {}), ...(Object.keys(range).length ? { checkIn: range } : {}) };
    const [total, rows] = await Promise.all([
      db().booking.count({ where }),
      db().booking.findMany({ where, orderBy: { checkIn: "desc" }, skip: (q.page - 1) * q.per, take: q.per, include: { room: { select: { no: true } } } }),
    ]);
    return { data: rows.map((b) => ({ id: `BK-${String(b.seq).padStart(4, "0")}`, status: b.status, check_in: ymd(b.checkIn), check_out: ymd(b.checkOut), nights: Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / 864e5), room_type: b.roomType, room: b.room?.no ?? null, adults: b.adults, children: b.children, guest_name: b.guestName, rate: b.rate, source: b.source })), meta: { page: q.page, per: q.per, total } };
  });
}
