// Online travel sites on the kernel: calendar sync with Booking.com, Airbnb, Agoda and Expedia (iCal feeds both ways) and selling on those sites through
// Sheetal's channel team. Moved in P2-W6 from business/backend/src/modules/growth/routes.ts (feeds, the public iCal link) and
// business/backend/src/modules/ota/routes.ts (requests); every rule, message and status code unchanged.
// Where it fits: OtaController calls one method per route (the Channels page, "Other sites" on a listing). The admin API keeps syncing every feed every
// 2 hours and Sheetal's channel team works the requests in Admin → Channels; both use the same backend-core helpers (domain/ota.ts, domain/ota-requests.ts).
// How it works: a feed is saved (with its audit line and event in one transaction), then read from the site at once; reading a site happens outside
// any transaction (it can take 20 seconds), and what it brought is written as one line and event afterwards. Our own feed per room type is a signed
// public link: a day is closed when every room of the type is taken. Requests: the business asks, answers the team's questions (text and up to 3 private
// files) and can stop selling; each step writes its audit line and event with the request row.
// Rules: people who see the calendar (or manage the business settings) see feeds and requests, those who change it add and sync; only stays can be sold on
// other sites; people see requests of the branches in view. The booking writes of a feed sync do not take the room-type hold yet (Phase 2 leftover).

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BusinessEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import { buildIcal } from "@sheetal/backend-core/lib/ical";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { syncOtaFeed } from "@sheetal/backend-core/domain/ota";
import { OTA_CHANNELS, askForChannel, otaAccounts, otaSettings, pauseRequest, presentRequest, replyToRequest } from "@sheetal/backend-core/domain/ota-requests";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { OtaRepository } from "./ota.repository.js";

const SITES = ["booking", "airbnb", "agoda", "expedia", "other"] as const;
const SETTINGS_PERM = "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete";
const slug = (s: string) => encodeURIComponent(s);
type Line = { audit: { action: string; target: string }; event: { name: string; payload: object; branchId?: string | null } };

class OtaBase extends BaseRepository<BusinessEntity, never, never> {
  constructor() { super({ model: "otaFeed", branchField: null, ownerField: null, label: "This feed", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "asc" }] }); }
}
export interface OtaDeps { bus: EventBus; db: unknown; secretsKey: string | undefined; apiUrl: string; fetch?: Fetch; saveFile: (data: Buffer) => Promise<string> }

export class OtaService extends BaseService<BusinessEntity, never, never> {
  readonly ota = new OtaRepository();
  constructor(private readonly x: OtaDeps) {
    super({ app: "hotel", resource: "ota", repo: new OtaBase(), permissions: { read: "hotel.calendar.read", create: "hotel.calendar.update", update: "hotel.calendar.update", delete: "hotel.calendar.update" },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "ota", label: (f) => f.id }, bus: x.bus, requireVersion: false });
  }
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => Line): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1, { branchId: a.event.branchId ?? null });
      return r;
    });
  }
  private need(ctx: BusinessContext, message: string, ...perms: string[]) { if (!perms.some((p) => ctx.permissions.can(p))) throw forbidden(message); }
  private sign(tenantId: string, type: string) { return createHmac("sha256", this.x.secretsKey ?? "sheetal-local-development-only-key").update(`ical:${tenantId}:${type}`).digest("base64url").slice(0, 24); }
  /** Imports a site's stays (backend-core/src/domain/ota.ts); errors become a message for the person. */
  private async syncFeed(id: string) {
    try { return await syncOtaFeed(this.x.db as never, id, this.x.fetch); }
    catch (e) { throw badRequest(`Couldn't read the calendar: ${e instanceof Error ? e.message : "failed"}.`); }
  }
  private synced(ctx: BusinessContext, feed: { id: string; site: string; roomType: string }, r: { added: number; updated: number; cancelled: number }) {
    return this.write(ctx, async () => r, () => ({ audit: { action: "ota.feed_synced", target: `${feed.site} ${feed.roomType}: ${r.added} new, ${r.updated} changed, ${r.cancelled} cancelled` }, event: { name: "hotel.feed.synced", payload: { id: feed.id, added: r.added, updated: r.updated, cancelled: r.cancelled } } }));
  }

  // ───── Calendar feeds ─────
  async feeds(ctx: BusinessContext) {
    this.need(ctx, "Your role can't do this.", "hotel.calendar.read", SETTINGS_PERM);
    const [feeds, types] = await this.ota.feedsAndTypes(ctx);
    const api = this.x.apiUrl.replace(/\/$/, "");
    return {
      feeds,
      // Give these links to Booking.com / Airbnb ("import calendar") so stays booked here close those dates there.
      exports: types.map((t) => ({ type: t.type, url: `${api}/v1/ical/${ctx.business.id}/${slug(t.type)}/${this.sign(ctx.business.id, t.type)}.ics` })),
    };
  }
  async addFeed(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.need(ctx, "Your role can't do this.", "hotel.calendar.update", SETTINGS_PERM);
    const b = z.object({ type: z.string().trim().min(1).max(60), site: z.enum(SITES), url: z.url().refine((u) => u.startsWith("https://"), "Use the https calendar link from the site.") }).parse(raw);
    if (!(await this.ota.activeRoomsOfType(ctx, b.type))) throw badRequest("Add rooms of this type first.");
    const f = await this.write(ctx, (tx) => this.ota.addFeed(tx, { roomType: b.type, site: b.site, url: b.url }),
      (f) => ({ audit: { action: "ota.feed_added", target: `${b.site} ${b.type}` }, event: { name: "hotel.feed.added", payload: { id: f.id } } }));
    const r = await this.syncFeed(f.id).catch((e) => ({ error: e instanceof Error ? e.message : "failed" }));
    if (!("error" in r)) await this.synced(ctx, f, r);
    return { message: "error" in r ? `Saved, but the first sync failed: ${r.error}` : `Connected. ${r.added} stay${r.added === 1 ? "" : "s"} imported.` };
  }
  async syncNow(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.need(ctx, "Your role can't do this.", "hotel.calendar.update", SETTINGS_PERM);
    const f = await this.ota.feed(ctx, id);
    if (!f) throw notFound("Feed not found.");
    const r = await this.syncFeed(f.id);
    await this.synced(ctx, f, r);
    return { message: `Synced: ${r.added} new, ${r.updated} changed, ${r.cancelled} cancelled.`, data: r };
  }

  /** Our busy dates for one room type: a day is closed when every room of the type is taken. Public link, signed (no business context). */
  async ical(tenant: string, type: string, rawSig: string) {
    const sig = rawSig.replace(/\.ics$/, "");
    const want = this.sign(tenant, type);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw notFound("Calendar not found.");
    // Rooms of the type per branch, and the nights a branch closed for it: a closed branch's rooms don't count.
    const { perBranch, closedDays, stays } = await this.ota.busy(this.x.db as never, tenant, type, dayOf(ymd(new Date())));
    const rooms = perBranch.reduce((n, b) => n + b._count, 0);
    const full: string[] = [];
    for (let d = dayOf(ymd(new Date())).getTime(); d < Date.now() + 365 * 864e5; d += 864e5) {
      const taken = stays.filter((s) => s.checkIn.getTime() <= d && s.checkOut.getTime() > d).length;
      const open = perBranch.reduce((n, b) => n + (closedDays.some((c) => c.branchId === b.branchId && c.day.getTime() === d) ? 0 : b._count), 0);
      if (rooms > 0 && taken >= open) full.push(ymd(new Date(d)));
    }
    // Consecutive full days become one event.
    const events: { uid: string; start: string; end: string }[] = [];
    for (const day of full) {
      const last = events[events.length - 1];
      const next = ymd(new Date(dayOf(day).getTime() + 864e5));
      if (last && last.end === day) last.end = next; else events.push({ uid: `${tenant}-${slug(type)}-${day}`, start: day, end: next });
    }
    return buildIcal({ name: type, events });
  }

  // ───── Selling on other sites (requests to Sheetal's channel team) ─────
  private inView(ctx: BusinessContext) { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; }
  async requests(ctx: BusinessContext, rawQuery: unknown) {
    this.need(ctx, "You don't have access to this.", "hotel.calendar.read", SETTINGS_PERM);
    const q = z.object({ listingId: z.coerce.number().int().positive().optional() }).parse(rawQuery);
    const db = (ctx.tx ?? ctx.db) as never;
    const [rows, set, acc] = await Promise.all([this.ota.requests(ctx, this.inView(ctx), q.listingId), otaSettings(db), otaAccounts(db)]);
    const listings = await this.ota.listingTitles(ctx, rows.map((r) => r.listingId).filter((x): x is number => x !== null));
    const allowed = set.types[ctx.business.type] === true;
    return {
      data: rows.map((r) => ({ ...presentRequest(r), listing: listings.find((l) => l.id === r.listingId)?.title ?? "", code: listings.find((l) => l.id === r.listingId)?.code ?? "" })),
      meta: {
        allowed, minPhotos: set.minPhotos, payoutDays: set.payoutDays,
        channels: OTA_CHANNELS.map((c) => ({ id: c.id, name: c.name, days: c.days, available: allowed && set.sites[c.id]!.on && acc[c.id]!.status === "connected", commission: set.sites[c.id]!.commission, fee: set.sites[c.id]!.fee, markup: set.sites[c.id]!.markup })),
      },
    };
  }
  async ask(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.need(ctx, "You don't have access to this.", "hotel.calendar.update", SETTINGS_PERM);
    const b = z.object({ listingId: z.number().int().positive(), channel: z.string().max(20), price: z.number().int().min(0, "Mark-up can't be below 0.").max(100, "Mark-up can't be above 100."), note: z.string().trim().max(500).optional() }).strict().parse(raw); // strict: unknown fields are refused, not ignored
    const r = await this.write(ctx, (tx) => askForChannel((tx.tx ?? tx.db) as never, { tenant: { id: ctx.business.id, name: ctx.business.name, type: ctx.business.type }, ...b, who: ctx.actor.kind === "system" ? "Sheetal" : ctx.actor.name }),
      (r) => ({ audit: { action: "ota.requested", target: `${b.channel} #${b.listingId}` }, event: { name: "hotel.otarequest.sent", payload: { id: r.id, channel: b.channel }, branchId: r.branchId } }));
    return { status: 201, body: { message: "Sent. Sheetal's team will set it up and tell you here.", data: presentRequest(r) } };
  }
  async answer(ctx: BusinessContext, id: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.need(ctx, "You don't have access to this.", "hotel.calendar.update", SETTINGS_PERM);
    const b = z.object({ text: z.string().trim().max(1000).default(""), files: z.array(z.object({ data: z.string().max(14_000_000) })).max(3, "Up to 3 files.").default([]) }).parse(raw);
    if (!b.text && !b.files.length) throw badRequest("Write an answer or add a file.");
    const names: string[] = [];
    for (const f of b.files) names.push(await this.x.saveFile(Buffer.from(f.data, "base64")));
    const r = await this.write(ctx, (tx) => replyToRequest((tx.tx ?? tx.db) as never, { tenantId: ctx.business.id, id, who: ctx.actor.kind === "system" ? "Sheetal" : ctx.actor.name, text: b.text, files: names }),
      (r) => ({ audit: { action: "ota.replied", target: r.id }, event: { name: "hotel.otarequest.replied", payload: { id: r.id }, branchId: r.branchId } }));
    return { message: "Sent to Sheetal's team.", data: presentRequest(r) };
  }
  async stop(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.need(ctx, "You don't have access to this.", "hotel.calendar.update", SETTINGS_PERM);
    const r = await this.write(ctx, (tx) => pauseRequest((tx.tx ?? tx.db) as never, { tenantId: ctx.business.id, id, who: ctx.actor.kind === "system" ? "Sheetal" : ctx.actor.name }),
      (r) => ({ audit: { action: "ota.paused", target: r.id }, event: { name: "hotel.otarequest.paused", payload: { id: r.id }, branchId: r.branchId } }));
    return { message: "Done. Sheetal's team will take it down.", data: presentRequest(r) };
  }
}
