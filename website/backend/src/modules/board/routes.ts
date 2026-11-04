// The requirement board, offers on requirements, and the signed-in person's notifications.
// Where it fits: the website's Requirements page and the notification bell.
// How it works: buyers' requirements are listed so agencies and owners can offer one of their live listings; the
// buyer is told by email and notification.
// Rules: only first name, area, budget and type are shown: never phone or email, and numbers or links typed into the
// description are hidden. With the requirement fee on, a requirement appears only after Sheetal confirms the payment.

import type { FastifyInstance } from "fastify";
import type { Lead } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { requireUser } from "@sheetal/backend-core/modules/auth/sessions";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";
import { notify } from "@sheetal/backend-core/lib/notify";

export const FEE_KEY = "requirement_fee";
export interface FeeSettings { enabled: boolean; amount: number; note?: string }
export async function feeSettings(app: FastifyInstance): Promise<FeeSettings> {
  const row = await dbOf(app).appSetting.findUnique({ where: { key: FEE_KEY } });
  const v = (row?.value ?? {}) as Partial<FeeSettings>;
  return { enabled: !!v.enabled && Number(v.amount) > 0, amount: Number(v.amount) || 0, note: v.note };
}

/** Removes phone numbers, emails and links people type into free text. */
export const hideContacts = (s: string) => s
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email hidden]")
  .replace(/https?:\/\/\S+|www\.\S+/gi, "[link hidden]")
  .replace(/(\+?977[\s-]?)?\b9[78]\d[\s-]?\d{3}[\s-]?\d{4}\b|\b0\d{1,2}[\s-]?\d{6,7}\b/g, "[number hidden]");

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "Buyer";

export async function boardRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const OPEN = { kind: "requirement", public: true, status: { notIn: ["won", "lost"] } };

  const demand = (l: Lead) => {
    const d = (l.details ?? {}) as Record<string, unknown>;
    return {
      id: l.ref, name: firstName(l.name), first_name: firstName(l.name),
      requirement: d.property_type ?? null, property_type: d.property_type ?? null, purpose: d.tenant_option ?? null, tenant_option: d.tenant_option ?? null,
      location: d.location ?? null, prefered_location: d.location ?? null, preferred_location: d.location ?? null,
      minimum_budget: d.min_budget ?? null, maximum_budget: d.max_budget ?? null, bedrooms: d.bedrooms ?? null, vehicles: d.vehicles ?? null, facilities: d.facilities ?? [],
      description: l.message ? hideContacts(l.message).slice(0, 1000) : null, created_at: l.createdAt,
    };
  };

  app.get("/requirement-fee/settings-public", async () => {
    const f = await feeSettings(app);
    return { status: 200, data: { enabled: f.enabled, amount: f.amount, currency: "NPR", note: f.note ?? null } };
  });

  app.get("/property-demand-list", async () => {
    const rows = await db().lead.findMany({ where: { ...OPEN, createdAt: { gte: new Date(Date.now() - 180 * 864e5) } }, orderBy: { createdAt: "desc" }, take: 300 });
    return { status: 200, data: rows.map(demand) };
  });

  app.get("/demand-matches-by-requirements", async (request) => {
    const { requirement_form_ids } = z.object({ requirement_form_ids: z.string().max(4000).default("") }).parse(request.query);
    const refs = requirement_form_ids.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 300);
    const leads = await db().lead.findMany({ where: { ...OPEN, ref: { in: refs } }, select: { id: true, ref: true, _count: { select: { matches: true } } } });
    return { status: 200, data: leads.map((l) => ({ requirement_form_id: l.ref, matches_count: l._count.matches })) };
  });

  // An agent or owner offers one of their live listings for a requirement.
  app.post("/demand-match", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request) => {
    const user = requireUser(request);
    const b = z.object({ requirement_form_id: z.coerce.number().int().positive(), property_id: z.coerce.number().int().positive(), message: z.string().trim().max(1000).optional() }).parse(request.body);
    const lead = await db().lead.findFirst({ where: { ...OPEN, ref: b.requirement_form_id } });
    if (!lead) throw notFound("This requirement isn't open any more.");
    const listing = await db().listing.findFirst({ where: { id: b.property_id, status: "published" } });
    if (!listing) throw notFound("Choose one of your live listings.");
    const mine = listing.userId === user.id || (!!listing.tenantId && user.memberships.some((m) => m.tenantId === listing.tenantId && hasPerm(m.role.perms, "listings.manage")));
    if (!mine) throw forbidden("You can offer only your own listings.");
    if (lead.userId && lead.userId === user.id) throw badRequest("This is your own requirement.");
    const exists = await db().demandMatch.findUnique({ where: { leadId_listingId: { leadId: lead.id, listingId: listing.id } } });
    if (exists) throw badRequest("You already offered this listing for this requirement.");
    await db().demandMatch.create({ data: { leadId: lead.id, listingId: listing.id, userId: user.id, message: b.message ? hideContacts(b.message) : "" } });

    // The buyer hears about it: by email (their address stays private to Sheetal) and in their notifications.
    const site = app.config.SITE_URL.replace(/\/$/, "");
    const link = `${site}/property/${listing.slug}`;
    if (lead.email) {
      await app.mailer.send({
        to: lead.email, subject: `A property for your requirement REQ-${String(lead.ref).padStart(4, "0")}`,
        text: `Namaste ${firstName(lead.name)},\n\n${user.userName} offered a property that may fit what you are looking for:\n\n${listing.title} (${listing.code})\n${link}${b.message ? `\n\nTheir note: ${hideContacts(b.message)}` : ""}\n\nUse the contact button on the property page if you are interested.\n\nSheetal Property`,
      });
    }
    await notify(db(), [lead.userId], { type: "demand_match", title: "A property was offered for your requirement", message: `${listing.title} (${listing.code})`, link: `/property/${listing.slug}` });
    return { status: 200, message: "Offer sent. The buyer gets your listing by email." };
  });

  // ───── Notifications ─────
  app.get("/agent-notifications", async (request) => {
    const user = requireUser(request);
    const [rows, unread] = await Promise.all([
      db().notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      db().notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      status: 200, unread_count: unread, meta: { unread_count: unread },
      data: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, message: n.message, link: n.link, read: !!n.readAt, read_at: n.readAt, created_at: n.createdAt })),
    };
  });

  app.post("/agent-notifications/read-all", async (request) => {
    const user = requireUser(request);
    await db().notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { status: 200 };
  });
}
