// What visitors do: save listings, send enquiries (contact, site visit, requirement, service) and write reviews.
// Where it fits: forms on property, agency and requirement pages (components/Forms.jsx, pages/Requirement.jsx).
// How it works: an enquiry becomes a lead for the listing's business, at the listing's branch, with an email and a
// notification to the people who handle leads there. Reviews notify the people who answer reviews.
// Rules: spam traps and rate limits on every form; a business can't review itself; one review per person per listing
// or business. Forms send FormData or JSON; both are read the same way.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, notFound } from "@sheetal/backend-core/lib/errors";
import { requireUser } from "@sheetal/backend-core/modules/auth/sessions";
import { savePrivateFile } from "@sheetal/backend-core/lib/files";
import { headOffice } from "@sheetal/backend-core/domain/branches";
import { leadPeople, notify, notifyStaff, teamWith } from "@sheetal/backend-core/lib/notify";
import { listingCard, mediaBase } from "../catalog/present.js";
import { feeSettings } from "../board/routes.js";

const LIVE: Prisma.ListingWhereInput = { status: { in: ["published", "sold", "rented"] } };
const strict = (max: number) => ({ config: { rateLimit: { max, timeWindow: "1 minute" } } });

const text = (max: number) => z.string().trim().max(max).optional().default("");
const phone = z.string().trim().max(30).optional().transform((v) => (v ? v.replace(/[^\d+]/g, "") : undefined));
const listingId = z.union([z.coerce.number().int().positive(), z.literal("").transform(() => undefined)]).optional();
const list = z.union([z.array(z.string().max(120)), z.string().max(120).transform((s) => [s])]).optional().default([]);

// Forms send FormData (strings, "x[]" for lists) or JSON; this reads both the same way.
const field = (b: Record<string, unknown>, k: string) => b[k] ?? b[`${k}[]`];
const flat = (b: unknown) => {
  const o = (b ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(o).map((k) => [k.replace(/\[\]$/, ""), field(o, k.replace(/\[\]$/, ""))]));
};

const KIND = { "contact-agent": "contact_agent", "contact-owner": "contact_owner", "schedule-tour": "site_visit", "requirement-form": "requirement", "agent-requirement-form": "requirement", contact: "service" } as const;

export async function engageRoutes(app: FastifyInstance) {
  const base = mediaBase(app.config);

  // ───── Favourites ─────
  app.get("/user-favourites-list", async (request) => {
    const user = requireUser(request);
    const favs = await dbOf(app).favourite.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    const rows = await dbOf(app).listing.findMany({ where: { id: { in: favs.map((f) => f.listingId) }, ...LIVE }, include: { photos: { orderBy: { sort: "asc" } } } });
    const byId = new Map(rows.map((l) => [l.id, l]));
    return { status: 200, data: favs.filter((f) => byId.has(f.listingId)).map((f) => ({ property_id: f.listingId, created_at: f.createdAt, property: listingCard(byId.get(f.listingId)!, base) })) };
  });

  app.post("/add-to-favourite", async (request) => {
    const user = requireUser(request);
    const { property_id } = z.object({ property_id: z.coerce.number().int().positive() }).parse(request.body);
    if (!(await dbOf(app).listing.findFirst({ where: { id: property_id, ...LIVE }, select: { id: true } }))) throw notFound("This property isn't available any more.");
    await dbOf(app).favourite.upsert({ where: { userId_listingId: { userId: user.id, listingId: property_id } }, create: { userId: user.id, listingId: property_id }, update: {} });
    return { status: 200, message: "Saved" };
  });

  app.post("/remove-from-favourite", async (request) => {
    const user = requireUser(request);
    const { property_id } = z.object({ property_id: z.coerce.number().int().positive() }).parse(request.body);
    await dbOf(app).favourite.deleteMany({ where: { userId: user.id, listingId: property_id } });
    return { status: 200, message: "Removed" };
  });

  // ───── Enquiries → leads for the business ─────
  for (const [path, kind] of Object.entries(KIND)) {
    app.post(`/${path}`, strict(8), async (request) => {
      const raw = flat(request.body);
      const b = z.object({
        name: z.string().trim().min(2, "Enter your name.").max(80),
        email: z.union([z.email("Enter a valid email address."), z.literal("")]).optional(),
        phone, mobile_number: phone,
        property_id: listingId, agent_id: z.string().trim().max(40).optional(),
        message_description: text(4000), contact_form: text(4000), reason_other: text(2000), description: text(4000),
        reasons: list, date: text(20), time: text(20), preferred_contact_time: text(40), preferred_date: text(20),
        // Buyer requirement fields
        tenant_option: text(20), property_type: text(60), prefered_location: text(200), minimum_budget: text(20), maximum_budget: text(20), bedrooms: text(5), vehicles: text(5), facilities: list,
        website: z.string().max(0, "Something went wrong.").optional(), // spam trap: hidden field people never fill
      }).parse(raw);
      const contact = b.phone || b.mobile_number;
      if (!b.email && !contact) throw badRequest("Add a phone number or an email so they can reach you.", { phone: ["Add a phone number or an email."] });

      const db = dbOf(app);
      const listing = b.property_id ? await db.listing.findFirst({ where: { id: b.property_id, ...LIVE }, select: { id: true, tenantId: true, branchId: true, title: true, code: true } }) : null;
      const agency = !listing && b.agent_id ? await db.tenant.findUnique({ where: { id: b.agent_id }, select: { id: true } }) : null;
      const tenantId = listing?.tenantId ?? agency?.id ?? null;
      const message = [b.message_description, b.contact_form, b.reason_other, b.description].filter(Boolean).join("\n").slice(0, 4000);
      const details = Object.fromEntries(Object.entries({
        reasons: b.reasons, date: b.date, time: b.time, preferred_contact_time: b.preferred_contact_time, preferred_date: b.preferred_date,
        tenant_option: b.tenant_option, property_type: b.property_type, location: b.prefered_location, min_budget: b.minimum_budget, max_budget: b.maximum_budget,
        bedrooms: b.bedrooms, vehicles: b.vehicles, facilities: b.facilities,
      }).filter(([, v]) => (Array.isArray(v) ? v.length : v)));

      // Buyer requirements sent to Sheetal (not to one agency) go on the requirement board; with a fee switched on,
      // only after Sheetal confirms the payment proof.
      const board = kind === "requirement" && !tenantId;
      const fee = board ? await feeSettings(app) : null;
      let feeData: Partial<Prisma.LeadUncheckedCreateInput> = {};
      if (fee?.enabled) {
        const rawBody = (request.body ?? {}) as Record<string, unknown>;
        const proof = [rawBody.payment_proof].flat().find((x): x is Buffer => Buffer.isBuffer(x));
        if (!proof) throw badRequest("Please upload the payment screenshot.", { payment_proof: ["Upload the payment screenshot."] });
        const ref = typeof rawBody.payment_reference === "string" ? rawBody.payment_reference.trim().slice(0, 80) : undefined;
        feeData = { feeStatus: "pending", feeAmount: fee.amount, feeRef: ref || null, feeProof: await savePrivateFile(app.config.MEDIA_DIR, "proofs", proof) };
      }
      const branchId = tenantId ? listing?.branchId ?? await headOffice(db, tenantId) : null;
      const lead = await db.lead.create({ data: { tenantId, branchId, listingId: listing?.id, userId: request.user?.id, kind, name: b.name, email: b.email || null, phone: contact, message, details, ip: request.ip, public: board && !fee?.enabled, ...feeData } });
      // A requirement fee proof waits for Sheetal's team.
      if (feeData.feeStatus === "pending") await notifyStaff(db, "moderation.listings", { type: "requirement", title: "Requirement fee to check", message: `${b.name} · Rs. ${feeData.feeAmount}`, link: "/admin/demand" });
      if (tenantId) await notify(db, await leadPeople(db, tenantId, branchId), { tenantId, type: "lead", title: `New enquiry from ${b.name}`, message: listing ? `${listing.title} (${listing.code})` : message.slice(0, 140), link: "/business/inbox" });
      // No business behind it: a lead for Sheetal's own team (Admin → Inbox → Leads).
      else await notifyStaff(db, "tenants.view", { type: "lead", title: `New lead for Sheetal: ${b.name}`, message: message.slice(0, 140), link: "/admin/leads" });

      // Let the business know by email (their Inbox shows it too).
      const to = tenantId ? (await db.tenant.findUnique({ where: { id: tenantId }, select: { email: true } }))?.email : null;
      if (to) {
        const what = { contact_agent: "An enquiry", contact_owner: "A message for the owner", site_visit: "A site visit request", requirement: "A buyer requirement", service: "A service request" }[kind];
        await app.mailer.send({
          to, subject: `${what}${listing ? ` for ${listing.code}` : ""} from ${b.name}`,
          text: [`${what} came in on Sheetal Property.`, "", `Name: ${b.name}`, contact ? `Phone: ${contact}` : "", b.email ? `Email: ${b.email}` : "", listing ? `Property: ${listing.title} (${listing.code})` : "", b.date ? `Visit: ${b.date} ${b.time}` : "", message ? `\n${message}` : "", "", "Reply from your Inbox in Sheetal Business."].filter((x) => x !== "").join("\n"),
        });
      }
      if (fee?.enabled) return { status: 200, message: `Thanks. Your requirement shows to agents once Sheetal confirms your payment (REQ-${String(lead.ref).padStart(4, "0")}).` };
      return { status: 200, message: kind === "site_visit" ? "Visit requested. They will confirm the time with you." : board ? `Thanks. Agents can now offer you properties (REQ-${String(lead.ref).padStart(4, "0")}).` : "Sent. We will get back to you soon." };
    });
  }

  // ───── Reviews ─────
  // (P1-BE-6: the business panel reads these through apps/reviews; a review written here carries createdBy, and a changed one bumps `version` and `updatedBy`.)
  app.get("/reviews-public", async (request) => {
    const q = z.object({ type: z.enum(["property", "agent"]).default("property"), property_id: z.coerce.number().int().positive().optional(), agent_id: z.string().max(40).optional() }).parse(request.query);
    const where = q.type === "agent" ? { tenantId: q.agent_id ?? "-" } : { listingId: q.property_id ?? -1 };
    const rows = await dbOf(app).review.findMany({ where: { ...where, status: "published" }, orderBy: { createdAt: "desc" }, take: 100 });
    const users = await dbOf(app).user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, userName: true, photoUrl: true } });
    const who = new Map(users.map((u) => [u.id, u]));
    return { status: 200, data: rows.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, reply: r.reply, created_at: r.createdAt, user: { name: who.get(r.userId)?.userName ?? "Sheetal user", photo: who.get(r.userId)?.photoUrl ?? null } })) };
  });

  app.post("/reviews", strict(10), async (request) => {
    const user = requireUser(request);
    const b = z.object({
      type: z.enum(["property", "agent"]).default("property"), rating: z.coerce.number().int().min(1, "Choose 1 to 5 stars.").max(5),
      comment: z.string().trim().max(2000).default(""), property_id: z.coerce.number().int().positive().optional(), agent_id: z.string().max(40).optional(),
    }).parse(request.body);
    const db = dbOf(app);
    if (b.type === "agent") {
      if (!b.agent_id || !(await db.tenant.findUnique({ where: { id: b.agent_id }, select: { id: true } }))) throw notFound("Agency not found.");
      if (user.memberships.some((m) => m.tenantId === b.agent_id)) throw badRequest("You can't review your own business.");
      const had = await db.review.findUnique({ where: { userId_tenantId: { userId: user.id, tenantId: b.agent_id } }, select: { id: true } });
      await db.review.upsert({ where: { userId_tenantId: { userId: user.id, tenantId: b.agent_id } }, create: { userId: user.id, tenantId: b.agent_id, rating: b.rating, comment: b.comment, createdBy: user.id }, update: { rating: b.rating, comment: b.comment, updatedBy: user.id, version: { increment: 1 } } });
      if (!had) await notify(db, await teamWith(db, b.agent_id, ["reviews.review.reply"]), { tenantId: b.agent_id, type: "review", title: `New ${b.rating}-star review`, message: b.comment.slice(0, 140), link: "/business/reviews" });
    } else {
      const l = b.property_id ? await db.listing.findFirst({ where: { id: b.property_id, ...LIVE }, select: { id: true, tenantId: true, branchId: true, title: true } }) : null;
      if (!l) throw notFound("This property isn't available any more.");
      if (l.tenantId && user.memberships.some((m) => m.tenantId === l.tenantId)) throw badRequest("You can't review your own listing.");
      const had = await db.review.findUnique({ where: { userId_listingId: { userId: user.id, listingId: l.id } }, select: { id: true } });
      await db.review.upsert({ where: { userId_listingId: { userId: user.id, listingId: l.id } }, create: { userId: user.id, listingId: l.id, rating: b.rating, comment: b.comment, createdBy: user.id }, update: { rating: b.rating, comment: b.comment, updatedBy: user.id, version: { increment: 1 } } });
      // The business's people who answer reviews, at the listing's branch.
      if (!had && l.tenantId) await notify(db, await teamWith(db, l.tenantId, ["reviews.review.reply"], l.branchId), { tenantId: l.tenantId, type: "review", title: `New ${b.rating}-star review: ${l.title}`, message: b.comment.slice(0, 140), link: "/business/reviews" });
    }
    return { status: 200, message: "Thanks for your review." };
  });
}
