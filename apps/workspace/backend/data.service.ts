// Import and export for the business panel's Import / Export buttons, on the kernel. Moved from business/backend/src/modules/data/routes.ts in P2-W6
// (Workspace part 2); every rule, message, status code and audit string unchanged.
// Where it fits: DataActions on the Listings, Inbox, Rooms, Bookings and Team pages, once signed in (the CSV file is made and read in the browser; rows
// travel here as JSON, keyed like the templates in shared/src/components/DataIO.jsx).
// How it works: browse() sends the rows of listings, leads, rooms, bookings or team members; importRows() takes listings (saved as drafts in the picked
// branch, within the plan's room) or leads (into the Inbox, with their stage, source and budget). Other kinds still work in the browser. An import is ONE
// transaction with its audit line and its event: all rows or none.
// Rules: the same permissions and branches as the pages they come from; at most 2,000 rows per import.

import { z } from "zod";
import { AppError, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BusinessEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import { LISTING_PERMS, kindsFor, listingCap } from "@sheetal/backend-core/domain/listings";
import { DataRepository, type InView } from "./data.repository.js";
import { SETTINGS_PERM } from "./workspace.service.js";

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

class DataBase extends BaseRepository<BusinessEntity, never, never> {
  constructor() { super({ model: "listing", branchField: "branchId", ownerField: null, label: "This row", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
}
export interface DataDeps { bus: EventBus; catalogKinds: () => Record<string, string[]> | undefined }

export class DataService extends BaseService<BusinessEntity, never, never> {
  readonly data = new DataRepository();
  constructor(private readonly x: DataDeps) {
    super({ app: "workspace", resource: "data", repo: new DataBase(), permissions: { read: SETTINGS_PERM, create: SETTINGS_PERM, update: SETTINGS_PERM, delete: SETTINGS_PERM },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "data", label: (r) => r.id }, bus: x.bus, requireVersion: false });
  }
  private inView(ctx: BusinessContext): InView { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; }
  private need(ctx: BusinessContext, perms: readonly string[], what: string) { if (!perms.some((p) => ctx.permissions.can(p))) throw forbidden(`Your role can't see ${what}.`); }
  private imported(ctx: BusinessContext, kind: "listings" | "leads", run: (tx: BusinessContext) => Promise<number>) {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const n = await run(tx);
      await this.writeAudit(tx, `data.import_${kind}`, String(n));
      await this.deps.bus.publish(tx, "workspace.data.imported", { kind, count: n }, 1);
      return n;
    });
  }

  async browse(ctx: BusinessContext, kind: string) {
    const v = this.inView(ctx);
    switch (kind) {
      case "listings": {
        this.need(ctx, LISTING_PERMS, "listings");
        const rows = await this.data.listings(ctx, v);
        return rows.map((l) => ({ title: l.title, purpose: l.purpose === "rent" ? "Rent" : "Sale", type: l.category, district: l.district ?? "", area: l.area ?? "", price: l.price == null ? "" : Number(l.price), land: l.landArea ?? "", beds: l.bedrooms ?? "", code: l.code, status: l.status }));
      }
      case "leads": {
        this.need(ctx, ["crm.lead.read", "crm.message.reply"], "leads");
        const rows = await this.data.leads(ctx, v);
        const ids = [...new Set(rows.map((r) => r.listingId).filter((x): x is number => x != null))];
        const codes = new Map((await this.data.listingCodes(ctx, ids)).map((l) => [l.id, l.code]));
        return rows.map((r) => { const ch = ((r.details ?? {}) as { channel?: string }).channel ?? "website"; return { name: r.name, phone: r.phone ?? "", email: r.email ?? "", source: CHANNEL_OUT[ch] ?? ch, listing: r.listingId ? codes.get(r.listingId) ?? "" : "", budget: r.value == null ? "" : Number(r.value), stage: STAGE_OUT[r.status] ?? r.status }; });
      }
      case "rooms": case "units": {
        this.need(ctx, ["hotel.booking.read", "hotel.calendar.read", "pos.frontdesk.use"], "rooms");
        const rows = await this.data.rooms(ctx, v);
        return rows.map((r) => ({ no: r.no, type: r.type, beds: "", pax: r.maxGuests, rate: r.rate, floor: r.floor ?? "" }));
      }
      case "bookings": {
        this.need(ctx, ["hotel.booking.read"], "bookings");
        const rows = await this.data.bookings(ctx, v);
        return rows.map((b) => { const nights = Math.max(1, Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / 864e5)); return { guest: b.guestName, phone: b.phone ?? "", room: b.room?.no ?? "", from: day(b.checkIn), to: day(b.checkOut), guests: b.adults + b.children, amount: b.rate * nights, paid: "", source: SOURCE_OUT[b.source] ?? b.source }; });
      }
      case "team": case "staff": {
        this.need(ctx, ["workspace.team.read"], "the team");
        const rows = await this.data.team(ctx);
        return rows.map((m) => ({ name: m.user.userName, email: m.user.email, phone: m.user.phone ?? "", role: m.role.name || m.role.key.replace(/_/g, " "), status: m.status === "paused" ? "Paused" : "Active" }));
      }
      default: throw notFound("This list can't be exported from the server yet.");
    }
  }

  async importRows(ctx: BusinessContext, kind: string, raw: unknown) {
    const can = (p: string) => ctx.permissions.can(p);
    if (kind === "listings") {
      if (!LISTING_PERMS.some(can)) throw forbidden("Your role can't add listings.");
      const { rows } = Rows(ListingRow).parse(raw);
      const t = await this.data.tenant(ctx);
      const allowed = kindsFor(t.type, t.plan, this.x.catalogKinds());
      for (const r of rows) {
        const k = r.purpose === "Rent" ? "rentout" : "sell";
        if (!allowed.includes(k)) throw forbidden(r.purpose === "Rent" ? "This business can't list rentals on its plan." : "This business can't list sales on its plan.");
      }
      const cap = listingCap(await this.data.planWithAddons(ctx, t.plan));
      if (cap !== -1) {
        const used = await this.data.countedListings(ctx);
        if (used + rows.length > cap) throw new AppError(402, "listing_limit", `Your plan has room for ${cap} listings and ${used} are used. Import fewer rows or upgrade.`);
      }
      const branchId = ctx.branches.branchForNew();
      const n = await this.imported(ctx, "listings", (tx) => this.data.addListingDrafts(tx, rows.map((r) => ({
        branchId, userId: ctx.member.userId, kind: r.purpose === "Rent" ? "rentout" : "sell", purpose: r.purpose === "Rent" ? "rent" : "sale",
        category: r.type || "House", title: r.title, status: "draft", price: r.price ? BigInt(Math.round(r.price)) : null, pricePer: r.purpose === "Rent" ? "month" : null,
        district: r.district || null, area: r.area || null, bedrooms: r.beds ? Math.round(r.beds) : null,
        landArea: r.land ? `${r.land} Aana` : null, landSqft: r.land ? r.land * 342.25 : null, slugBase: slugify(r.title),
      }))));
      return { message: `${n} ${n === 1 ? "listing" : "listings"} imported as drafts. Add photos and send them for review from Listings.`, data: { imported: n } };
    }

    if (kind === "leads") {
      if (!["crm.lead.read", "crm.message.reply"].some(can)) throw forbidden("Your role can't add leads.");
      const { rows } = Rows(LeadRow).parse(raw);
      const codes = [...new Set(rows.map((r) => r.listing).filter((x): x is string => !!x))];
      const listings = new Map((await this.data.listingsByCode(ctx, this.inView(ctx), codes)).map((l) => [l.code, l]));
      const fallback = codes.length === rows.length && rows.every((r) => r.listing && listings.has(r.listing)) ? null : ctx.branches.branchForNew();
      const now = new Date();
      await this.imported(ctx, "leads", async (tx) => (await this.data.addLeads(tx, rows.map((r) => {
        const l = r.listing ? listings.get(r.listing) : undefined;
        return {
          branchId: l?.branchId ?? fallback, listingId: l?.id ?? null, kind: "import", name: r.name, phone: r.phone || null, email: r.email?.toLowerCase() ?? null,
          message: "Imported lead", details: { channel: CHANNEL_IN[r.source ?? ""] ?? "website", source: r.source ?? "Import" }, status: STAGE_IN[r.stage ?? ""] ?? "new",
          value: r.budget ? BigInt(Math.round(r.budget)) : null, lastAt: now,
        };
      }))).count);
      return { message: `${rows.length} ${rows.length === 1 ? "lead" : "leads"} added to the Inbox.`, data: { imported: rows.length } };
    }

    throw notFound("This list can't be imported to the server yet.");
  }
}
