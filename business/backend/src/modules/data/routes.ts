// Import and export for the business panel's Import / Export buttons (the CSV file is made and read in the browser;
// rows travel here as JSON, keyed like the templates in shared/src/components/DataIO.jsx).
// Where it fits: DataActions on the Listings, Inbox, Rooms, Bookings and Team pages, once signed in.
// How it works: GET /data/:kind sends the rows of listings, leads, rooms, bookings or team members; POST /data/:kind
// takes listings (saved as drafts in the picked branch, within the plan's room) or leads (into the Inbox, with their
// stage, source and budget). Other kinds still work in the browser until their pages are on the server.
// Rules: the same permissions and branches as the pages they come from; at most 2,000 rows per import.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { COUNTED, LISTING_PERMS, kindsFor, listingCap } from "@sheetal/backend-core/domain/listings";
import { catalogKindsNow } from "@sheetal/backend-core/lib/catalog";
import { listingCode, prefixFor } from "@sheetal/backend-core/domain/codes";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { branchFor, branchView, inView, workspaceOf, type Workspace } from "../access.js";

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "property";
const STAGE_OUT: Record<string, string> = { new: "New", contacted: "Talking", negotiating: "Talking", viewing: "Visit", won: "Won", lost: "Lost" };
const STAGE_IN: Record<string, string> = { New: "new", Talking: "contacted", Visit: "viewing", Won: "won", Lost: "lost" };
const CHANNEL_OUT: Record<string, string> = { whatsapp: "WhatsApp", messenger: "Facebook", instagram: "Instagram", website: "Website", sms: "Walk-in" };
const CHANNEL_IN: Record<string, string> = { WhatsApp: "whatsapp", Facebook: "messenger", Instagram: "instagram", Website: "website", "Walk-in": "walkin" };
const SOURCE_OUT: Record<string, string> = { shetal: "Sheetal", booking: "Booking.com", airbnb: "Airbnb", walkin: "Walk-in", direct: "Website" };

const text = (max: number) => z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().max(max));
const opt = (max: number) => z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v == null ? undefined : String(v).trim() || undefined)).pipe(z.string().max(max).optional());
const num = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v === "" || v == null ? undefined : Number(v))).pipe(z.number().min(0).max(1e13).optional());

const ListingRow = z.object({ title: text(150).pipe(z.string().min(3, "Title is too short.")), purpose: z.enum(["Sale", "Rent"]), type: text(60), district: text(60), area: text(120), price: num, land: num, beds: num });
const LeadRow = z.object({ name: text(120).pipe(z.string().min(1)), phone: text(30), email: opt(160), source: opt(30), listing: opt(20), budget: num, stage: opt(20) });
const Rows = <T extends z.ZodType>(row: T) => z.object({ rows: z.array(row).min(1, "There are no rows to import.").max(2000, "Import up to 2,000 rows at a time.") });

export async function dataRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const need = (ws: Workspace, perms: string[], what: string) => { if (!perms.some(ws.can)) throw forbidden(`Your role can't see ${what}.`); };

  app.get<{ Params: { kind: string } }>("/data/:kind", async (request) => {
    const ws = workspaceOf(request);
    const v = await branchView(db(), request, ws);
    const where = { tenantId: ws.tenantId, ...inView(v) };
    switch (request.params.kind) {
      case "listings": {
        need(ws, LISTING_PERMS as unknown as string[], "listings");
        const rows = await db().listing.findMany({ where: { ...where, status: { not: "removed" } }, orderBy: { createdAt: "desc" }, take: 10_000 });
        return { data: rows.map((l) => ({ title: l.title, purpose: l.purpose === "rent" ? "Rent" : "Sale", type: l.category, district: l.district ?? "", area: l.area ?? "", price: l.price == null ? "" : Number(l.price), land: l.landArea ?? "", beds: l.bedrooms ?? "", code: l.code, status: l.status })) };
      }
      case "leads": {
        need(ws, ["leads.view", "messages.reply"], "leads");
        const rows = await db().lead.findMany({ where, orderBy: { createdAt: "desc" }, take: 10_000 });
        const ids = [...new Set(rows.map((r) => r.listingId).filter((x): x is number => x != null))];
        const codes = new Map((await db().listing.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } })).map((l) => [l.id, l.code]));
        return { data: rows.map((r) => { const ch = ((r.details ?? {}) as { channel?: string }).channel ?? "website"; return { name: r.name, phone: r.phone ?? "", email: r.email ?? "", source: CHANNEL_OUT[ch] ?? ch, listing: r.listingId ? codes.get(r.listingId) ?? "" : "", budget: r.value == null ? "" : Number(r.value), stage: STAGE_OUT[r.status] ?? r.status }; }) };
      }
      case "rooms": case "units": {
        need(ws, ["bookings.view", "calendar.view", "pos.frontdesk"], "rooms");
        const rows = await db().room.findMany({ where: { ...where, active: true }, orderBy: { no: "asc" } });
        return { data: rows.map((r) => ({ no: r.no, type: r.type, beds: "", pax: r.maxGuests, rate: r.rate, floor: r.floor ?? "" })) };
      }
      case "bookings": {
        need(ws, ["bookings.view"], "bookings");
        const rows = await db().booking.findMany({ where, include: { room: { select: { no: true } } }, orderBy: { checkIn: "desc" }, take: 10_000 });
        return { data: rows.map((b) => { const nights = Math.max(1, Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / 864e5)); return { guest: b.guestName, phone: b.phone ?? "", room: b.room?.no ?? "", from: day(b.checkIn), to: day(b.checkOut), guests: b.adults + b.children, amount: b.rate * nights, paid: "", source: SOURCE_OUT[b.source] ?? b.source }; }) };
      }
      case "team": case "staff": {
        need(ws, ["team.view"], "the team");
        const rows = await db().membership.findMany({ where: { tenantId: ws.tenantId, status: { in: ["active", "paused"] } }, include: { user: true, role: true }, orderBy: { createdAt: "asc" } });
        return { data: rows.map((m) => ({ name: m.user.userName, email: m.user.email, phone: m.user.phone ?? "", role: m.role.name || m.role.key.replace(/_/g, " "), status: m.status === "paused" ? "Paused" : "Active" })) };
      }
      default: throw notFound("This list can't be exported from the server yet.");
    }
  });

  app.post<{ Params: { kind: string } }>("/data/:kind", { bodyLimit: 5 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    const v = await branchView(db(), request, ws);

    if (request.params.kind === "listings") {
      if (!LISTING_PERMS.some(ws.can)) throw forbidden("Your role can't add listings.");
      const { rows } = Rows(ListingRow).parse(request.body);
      const t = ws.member.tenant;
      const allowed = kindsFor(t.type, t.plan, catalogKindsNow(app.db));
      for (const r of rows) {
        const kind = r.purpose === "Rent" ? "rentout" : "sell";
        if (!allowed.includes(kind)) throw forbidden(r.purpose === "Rent" ? "This business can't list rentals on its plan." : "This business can't list sales on its plan.");
      }
      const cap = listingCap(await effectiveLimits(db(), ws.tenantId, t.plan));
      if (cap !== -1) {
        const used = await db().listing.count({ where: { tenantId: ws.tenantId, status: { in: COUNTED } } });
        if (used + rows.length > cap) throw new AppError(402, "listing_limit", `Your plan has room for ${cap} listings and ${used} are used. Import fewer rows or upgrade.`);
      }
      const branchId = branchFor(v);
      let n = 0;
      for (const r of rows) {
        const tmp = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const l = await db().listing.create({ data: {
          code: tmp, slug: tmp, tenantId: ws.tenantId, branchId, userId: ws.user.id, kind: r.purpose === "Rent" ? "rentout" : "sell", purpose: r.purpose === "Rent" ? "rent" : "sale",
          category: r.type || "House", title: r.title, status: "draft", price: r.price ? BigInt(Math.round(r.price)) : null, pricePer: r.purpose === "Rent" ? "month" : null,
          district: r.district || null, area: r.area || null, bedrooms: r.beds ? Math.round(r.beds) : null,
          landArea: r.land ? `${r.land} Aana` : null, landSqft: r.land ? r.land * 342.25 : null,
        } });
        await db().listing.update({ where: { id: l.id }, data: { code: listingCode(await prefixFor(db(), ws.tenantId), l.id), slug: `${slugify(r.title)}-${l.id}` } });
        n++;
      }
      await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "data.import_listings", target: String(n), ip: request.ip } });
      return { message: `${n} ${n === 1 ? "listing" : "listings"} imported as drafts. Add photos and send them for review from Listings.`, data: { imported: n } };
    }

    if (request.params.kind === "leads") {
      if (!["leads.view", "messages.reply"].some(ws.can)) throw forbidden("Your role can't add leads.");
      const { rows } = Rows(LeadRow).parse(request.body);
      const codes = [...new Set(rows.map((r) => r.listing).filter((x): x is string => !!x))];
      const listings = new Map((await db().listing.findMany({ where: { tenantId: ws.tenantId, code: { in: codes }, ...inView(v) }, select: { id: true, code: true, branchId: true } })).map((l) => [l.code, l]));
      const fallback = codes.length === rows.length && rows.every((r) => r.listing && listings.has(r.listing)) ? null : branchFor(v);
      const now = new Date();
      await db().lead.createMany({ data: rows.map((r) => {
        const l = r.listing ? listings.get(r.listing) : undefined;
        return {
          tenantId: ws.tenantId, branchId: l?.branchId ?? fallback, listingId: l?.id ?? null, kind: "import", name: r.name, phone: r.phone || null, email: r.email?.toLowerCase() ?? null,
          message: "Imported lead", details: { channel: CHANNEL_IN[r.source ?? ""] ?? "website", source: r.source ?? "Import" }, status: STAGE_IN[r.stage ?? ""] ?? "new",
          value: r.budget ? BigInt(Math.round(r.budget)) : null, lastAt: now,
        };
      }) });
      await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "data.import_leads", target: String(rows.length), ip: request.ip } });
      return { message: `${rows.length} ${rows.length === 1 ? "lead" : "leads"} added to the Inbox.`, data: { imported: rows.length } };
    }

    throw notFound("This list can't be imported to the server yet.");
  });
}
