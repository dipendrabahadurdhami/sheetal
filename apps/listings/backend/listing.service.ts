// The rules of a business's listings: list, add (from the listing wizard), edit, duplicate, pause, publish, archive, mark sold, delete, move to another
// branch or another of the person's businesses, on the kernel. Moved from business/backend/src/modules/listings/routes.ts (P2-W5); every rule, message and
// audit string unchanged.
// Where it fits: ListingController calls one method per route.
// How it works: the wizard sends `values` (its form, kept privately so it can be edited again) and `summary` (the readable fields the website shows). New
// and changed listings wait as "pending" until Sheetal approves them in the admin panel (staff are notified after the change is saved). Each change runs in
// ONE transaction with its audit line(s) and its event.
// Rules: nothing goes live or changes on the website without review; the plan's room counts the whole business; photos must be names this API gave out;
// people only see their branches' listings; a listing is moved only into a business where the person manages listings and whose plan allows the kind.

import { z } from "zod";
import type { ListingStatus } from "@prisma/client";
import { AppError, badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BranchEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import { STAFF_FOR, notifyStaff } from "@sheetal/platform/notify/index";
import { photoUrl, savePhoto } from "@sheetal/backend-core/lib/photos";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";
import { COUNTED, LISTING_KINDS, LISTING_PERMS, kindsFor, listingCap } from "@sheetal/backend-core/domain/listings";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { ListingRepository, db } from "./listing.repository.js";
import { Body, BranchPick, LIVE, columns, day, formOf, priv, row, type Row, type SummaryIn } from "./presenter.js";

export interface ListingDeps { bus: EventBus; mediaBase: string; mediaDir: string; catalog: () => Record<string, string[]> | undefined }
type Audit = { action: string; target: string; tenantId?: string; meta?: object };
type L = BranchEntity;
class ListingBase extends BaseRepository<L, never, never> {
  constructor() { super({ model: "listing", ownerField: null, label: "This listing", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
}

function checkSubmit(s: SummaryIn) {
  const errors: Record<string, string[]> = {};
  if (s.title.length < 8) errors.title = ["Write a title of at least 8 characters."];
  if (!s.district) errors.location = ["Choose the district."];
  if (!s.photos.length) errors.photos = ["Add at least one photo."];
  if (Object.keys(errors).length) throw badRequest("A few things are missing before Sheetal can check it.", errors);
}

export class ListingService extends BaseService<L, never, never> {
  readonly listings = new ListingRepository();
  constructor(private readonly x: ListingDeps) {
    super({ app: "listings", resource: "listing", repo: new ListingBase(), permissions: { read: LISTING_PERMS[0]!, create: LISTING_PERMS[0]!, update: LISTING_PERMS[0]!, delete: LISTING_PERMS[0]! },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "listing", label: (l) => l.id }, bus: x.bus, requireVersion: false });
  }

  private canList(ctx: BusinessContext) { if (!LISTING_PERMS.some((p) => ctx.permissions.can(p))) throw forbidden("Your role can't manage listings."); }
  private kinds(type: string, plan: { features: unknown }) { return kindsFor(type, plan as never, this.x.catalog()); }
  /** One change: the transaction, its audit line(s) (an audit may name another business, for a move) and its event. */
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => { audit: Audit[]; event: { name: string; payload: object; branchId?: string | null } }): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      for (const line of a.audit) {
        if (!line.tenantId || line.tenantId === tx.business.id) await this.writeAudit(tx, line.action, line.target, line.meta);
        else await db(tx).auditLog.create({ data: { actorId: tx.member.userId, tenantId: line.tenantId, action: line.action, target: line.target, ip: tx.ip, meta: line.meta as object | undefined } });
      }
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1, { branchId: a.event.branchId ?? null });
      return r;
    });
  }
  /** How many listings the business may hold (-1 = no limit). On app subscriptions the Listings edition decides (free 3, full 500, grants on
   *  top); a business still on Starter / Business / Pro, or another business than the one signed in to, keeps its plan's number. */
  private async cap(ctx: BusinessContext, tenantId: string, plan: { price: number; limits: unknown }): Promise<number> {
    if (tenantId === ctx.business.id && ctx.entitlements.mode === "apps") return ctx.entitlements.limit("listings", "listings") ?? -1;
    return listingCap((await effectiveLimits(db(ctx) as never, tenantId, plan as never)) as never);
  }
  private async room(ctx: BusinessContext, tenantId: string, plan: { price: number; limits: unknown }, adding = 1) {
    const cap = await this.cap(ctx, tenantId, plan);
    if (cap === -1) return;
    if ((await this.listings.used(ctx, tenantId)) + adding > cap) {
      if (tenantId === ctx.business.id && ctx.entitlements.mode === "apps") throw new AppError(402, "listing_limit", `Your Listings edition has room for ${cap} listing${cap === 1 ? "" : "s"}. Archive some, or upgrade Listings in the Apps marketplace to add more.`);
      throw new AppError(402, "listing_limit", cap === 1 ? "The free Starter plan has room for one listing. Archive one or upgrade to add more." : `Your plan has room for ${cap} listings. Archive some or upgrade to add more.`);
    }
  }
  private async own(ctx: BusinessContext, code: string): Promise<Row> {
    const l = await this.listings.one(ctx, code);
    if (!l) throw notFound("Listing not found.");
    return l as Row;
  }
  private review(ctx: BusinessContext, title: string, message: string) {
    return notifyStaff(ctx.db as never, STAFF_FOR.listingReview, { type: "review", title, message, link: "/admin/moderation" });
  }

  // ───── Read ─────
  async browse(ctx: BusinessContext, rawQuery: unknown) {
    if (!LISTING_PERMS.some((p) => ctx.permissions.can(p)) && !ctx.permissions.can("workspace.overview.read")) throw forbidden("Your role can't see listings.");
    const q = z.object({
      page: z.coerce.number().int().min(1).optional(), per: z.coerce.number().int().min(10).max(500).default(100),
      q: z.string().trim().max(80).optional(), kind: z.enum(LISTING_KINDS).optional(),
      status: z.enum(["all", "published", "in_review", "draft", "paused", "rejected", "sold", "rented", "archived"]).default("all"),
    }).parse(rawQuery);
    const t = await this.listings.plan(ctx);
    // Counts are for the branches in view; the plan's room is for the whole business.
    const [byStatus, byKind, used] = await Promise.all([this.listings.byStatus(ctx), this.listings.byKind(ctx), this.listings.used(ctx)]);
    const counts: Record<string, number> = Object.fromEntries(byStatus.map((g) => [g.status === "pending" ? "in_review" : g.status, g._count]));
    counts.all = byStatus.filter((g) => g.status !== "archived").reduce((a, g) => a + g._count, 0);
    const meta = { cap: await this.cap(ctx, ctx.business.id, t.plan as never), used, kinds: this.kinds(t.type, t.plan), listedKinds: byKind.map((g) => g.kind), counts };
    if (!q.page) {
      const rows = await this.listings.summary(ctx);
      return { data: rows.map((l) => ({ id: l.code, tenantId: l.tenantId, kind: l.kind, title: l.title, status: l.status === "pending" ? "in_review" : l.status, price: l.price == null ? 0 : Number(l.price), updated: day(l.updatedAt), checkDue: day(l.checkDueAt), lastChecked: day(l.lastCheckedAt), branchId: l.branchId, branch: l.branch?.name ?? null })), meta };
    }
    const where = {
      ...this.listings.base(ctx),
      ...(q.status === "all" ? { status: { notIn: ["removed", "archived"] as ListingStatus[] } } : { status: (q.status === "in_review" ? "pending" : q.status) as ListingStatus }),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: "insensitive" as const } }, { code: { equals: q.q.toUpperCase() } }, { area: { contains: q.q, mode: "insensitive" as const } }] } : {}),
    };
    const [total, rows] = await Promise.all([this.listings.count(ctx, where), this.listings.page(ctx, where, (q.page - 1) * q.per, q.per)]);
    const leads = await this.listings.leadCounts(ctx, rows.map((r) => r.id));
    return { data: rows.map((l) => row(this.x.mediaBase, l as Row, leads.get(l.id) ?? 0)), meta: { ...meta, total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / q.per)), per_page: q.per } };
  }

  async one(ctx: BusinessContext, code: string) {
    this.canList(ctx);
    const l = await this.own(ctx, code);
    const leads = await this.listings.leadCounts(ctx, [l.id]);
    return { ...row(this.x.mediaBase, l, leads.get(l.id) ?? 0), values: formOf(this.x.mediaBase, l), reviewNote: l.reviewNote };
  }

  async photo(ctx: BusinessContext, raw: unknown) {
    this.canList(ctx);
    const { data } = z.object({ data: z.string().min(16).max(11 * 1024 * 1024) }).parse(raw);
    const file = await savePhoto(this.x.mediaDir, Buffer.from(data, "base64"));
    return { file, url: photoUrl(this.x.mediaBase, "main", file), thumbnail: photoUrl(this.x.mediaBase, "thumbnail", file) };
  }

  // ───── Add and edit ─────
  async add(ctx: BusinessContext, raw: unknown) {
    this.canList(ctx);
    const b = Body.parse(raw);
    const t = await this.listings.plan(ctx);
    if (!this.kinds(t.type, t.plan).includes(b.kind)) throw forbidden("This business can't list that kind of property on its plan.");
    if (b.submit) checkSubmit(b.summary);
    // The branch it belongs to: the one picked in the form, else the branch open in the panel.
    const branchId = ctx.branches.branchForNew(BranchPick.parse(raw).branchId);
    await this.room(ctx, ctx.business.id, t.plan);
    const { photos, ...summary } = b.summary;
    const created = await this.write(ctx, (tx) => this.listings.create(tx, {
      ...(columns(b.kind, { ...summary, photos }) as object), branchId, userId: tx.member.userId,
      status: b.submit ? "pending" : "draft", submittedAt: b.submit ? new Date() : null,
      private: { form: { ...b.values, photos: undefined } } as never,
    } as never, photos.map((file, sort) => ({ file, sort }))), (c) => ({ audit: [{ action: b.submit ? "listing.submitted" : "listing.draft_saved", target: c.code }], event: { name: b.submit ? "listings.listing.submitted" : "listings.listing.drafted", payload: { id: c.id, code: c.code, kind: b.kind }, branchId } }));
    if (b.submit) await this.review(ctx, "Listing to review", `${created.title} · ${ctx.business.name}`);
    return { message: b.submit ? "Sent to Sheetal for review. It goes live once checked, usually within a day." : "Saved as a draft.", data: row(this.x.mediaBase, created as Row, 0) };
  }

  async edit(ctx: BusinessContext, code: string, raw: unknown) {
    this.canList(ctx);
    const l = await this.own(ctx, code);
    const b = Body.parse(raw);
    const t = await this.listings.plan(ctx);
    // Moving it to another of the person's branches takes its enquiries along.
    const asked = BranchPick.parse(raw).branchId;
    const branchId = asked && asked !== l.branchId ? ctx.branches.branchForNew(asked) : null;
    if (b.kind !== l.kind && !this.kinds(t.type, t.plan).includes(b.kind)) throw forbidden("This business can't list that kind of property on its plan.");
    // What the website shows never changes without a check: edits to a live or paused listing must be sent for review.
    if (!b.submit && (LIVE.includes(l.status) || l.status === "paused")) throw badRequest("Send the changes to Sheetal for review; a live listing can't change without a check.");
    if (b.submit) checkSubmit(b.summary);
    if (["archived", "rejected"].includes(l.status) && b.submit) await this.room(ctx, ctx.business.id, t.plan);
    // Any change to what the website shows is checked again; a draft stays a draft until it is sent.
    const status: ListingStatus = b.submit ? "pending" : l.status === "draft" ? "draft" : l.status;
    const { photos, ...summary } = b.summary;
    const updated = await this.write(ctx, async (tx) => {
      const u = await this.listings.replace(tx, l.id, {
        ...columns(b.kind, { ...summary, photos }), status, submittedAt: b.submit ? new Date() : l.submittedAt,
        reviewNote: b.submit ? null : l.reviewNote, ...(branchId ? { branchId } : {}),
        private: { ...priv(l), form: { ...b.values, photos: undefined } } as never,
      }, photos.map((file, sort) => ({ file, sort })), b.version);
      if (!u) throw conflict("Someone else changed this listing. Reload to see the latest.");
      if (branchId) await this.listings.moveBranch(tx, l.id, branchId);
      return u;
    }, () => ({ audit: [{ action: b.submit ? "listing.submitted" : "listing.updated", target: l.code }], event: { name: b.submit ? "listings.listing.submitted" : "listings.listing.updated", payload: { id: l.id, code: l.code, kind: b.kind }, branchId: branchId ?? l.branchId } }));
    if (b.submit) await this.review(ctx, "Listing to review", `${l.title} · ${ctx.business.name}`);
    const leads = await this.listings.leadCounts(ctx, [l.id]);
    return {
      message: b.submit ? (LIVE.includes(l.status) ? "Changes sent for review. The listing is off the website until Sheetal checks them." : "Sent to Sheetal for review.") : "Saved.",
      data: row(this.x.mediaBase, updated as Row, leads.get(l.id) ?? 0),
    };
  }

  // ───── Status: publish, pause, archive (one or many) ─────
  async setStatus(ctx: BusinessContext, raw: unknown) {
    this.canList(ctx);
    const b = z.object({ ids: z.array(z.string().max(20)).min(1).max(500), status: z.enum(["published", "paused", "archived", "available", "sold"]) }).parse(raw);
    const rows = await this.listings.many(ctx, b.ids);
    if (!rows.length) throw notFound("Listing not found.");
    const t = await this.listings.plan(ctx);
    const reviewing: string[] = [];
    const plan: { id: number; code: string; next: ListingStatus }[] = [];
    for (const l of rows) {
      let next: ListingStatus | null = null;
      if (b.status === "paused") next = LIVE.includes(l.status) ? "paused" : null;
      else if (b.status === "archived") next = "archived";
      else if (b.status === "sold") next = LIVE.includes(l.status) ? (l.purpose === "rent" ? "rented" : "sold") : null;
      else if (b.status === "available") next = l.status === "sold" || l.status === "rented" ? "published" : null;
      else {
        // Publish: a listing Sheetal approved before goes straight back; anything else is sent for review.
        if (l.status === "pending" || LIVE.includes(l.status)) continue;
        if (l.status === "archived") await this.room(ctx, ctx.business.id, t.plan);
        const approved = !!l.publishedAt && l.status !== "rejected" && l.status !== "draft";
        if (!approved && !l.photos.length) throw badRequest(`Add a photo to "${l.title}" before sending it for review.`);
        next = approved ? "published" : "pending";
        if (next === "pending") reviewing.push(l.code);
      }
      if (!next || next === l.status) continue;
      plan.push({ id: l.id, code: l.code, next });
    }
    // On app subscriptions the website shows at most as many listings as the Listings edition allows (the owner's rule, 16 Nov 2026):
    // publishing more is refused here; the hourly check (domain/listing-limit.ts) would pause the extra ones anyway.
    const showing = plan.filter((p) => p.next === "published").length;
    if (showing && ctx.entitlements.mode === "apps") {
      const cap = ctx.entitlements.limit("listings", "listings");
      const live = cap === null ? 0 : await db(ctx).listing.count({ where: { tenantId: ctx.business.id, deletedAt: null, status: "published" } });
      if (cap !== null && live + showing > cap) throw new AppError(402, "listing_limit", `Your Listings edition shows ${cap} listing${cap === 1 ? "" : "s"} on the website and ${live} ${live === 1 ? "is" : "are"} live. Pause one first, or upgrade Listings in the Apps marketplace.`);
    }
    const changed = plan.map((p) => p.code);
    if (plan.length) {
      await this.write(ctx, async (tx) => { for (const p of plan) await this.listings.setStatus(tx, p.id, p.next, p.next === "pending"); return plan; },
        () => ({ audit: [{ action: `listing.${b.status}`, target: changed.join(", ") }], event: { name: "listings.listing.status_changed", payload: { codes: changed.join(", "), status: b.status } } }));
    }
    if (reviewing.length) await this.review(ctx, `${reviewing.length} listing${reviewing.length > 1 ? "s" : ""} to review`, ctx.business.name);
    const word = { published: "Published", paused: "Paused. Hidden from the website until you publish again.", archived: "Archived", sold: "Marked sold", available: "Available again" }[b.status];
    return { message: reviewing.length ? `${reviewing.length === changed.length ? "Sent" : `${changed.length - reviewing.length} published, ${reviewing.length} sent`} to Sheetal for review.` : changed.length ? word : "Nothing to change.", data: { changed } };
  }

  async duplicate(ctx: BusinessContext, code: string) {
    this.canList(ctx);
    const l = await this.own(ctx, code);
    await this.room(ctx, ctx.business.id, (await this.listings.plan(ctx)).plan);
    const { id: _id, code: _c, slug: _s, createdAt: _a, updatedAt: _u, photos, branch: _b, tenantId: _t, version: _v, createdBy: _cb, updatedBy: _ub, deletedAt: _da, deletedBy: _db, ...rest } = l as Row & { createdBy: unknown; updatedBy: unknown; deletedAt: unknown; deletedBy: unknown };
    const copy = await this.write(ctx, (tx) => this.listings.create(tx, {
      ...rest, details: rest.details as never, private: rest.private as never, suggest: undefined, reviewHold: false, reviewConflict: undefined,
      title: `${l.title} (copy)`.slice(0, 150), status: "draft", userId: tx.member.userId, views: 0, featured: false,
      legacyId: null, publishedAt: null, submittedAt: null, reviewedAt: null, reviewedBy: null, reviewNote: null, lastCheckedAt: null, lastCheckedBy: null, checkDueAt: null,
    } as never, photos.map((p) => ({ file: p.file, sort: p.sort }))), (c) => ({ audit: [{ action: "listing.duplicated", target: c.code, meta: { from: l.code } }], event: { name: "listings.listing.drafted", payload: { id: c.id, code: c.code, kind: c.kind }, branchId: c.branchId } }));
    return { message: "Copy saved as a draft.", data: row(this.x.mediaBase, copy as Row, 0) };
  }

  async removeMany(ctx: BusinessContext, raw: unknown) {
    this.canList(ctx);
    const { ids } = z.object({ ids: z.array(z.string().max(20)).min(1).max(500) }).parse(raw);
    // Kept as "removed" so leads and history still point somewhere; it no longer shows anywhere.
    const count = await this.write(ctx, async (tx) => { const c = await this.listings.remove(tx, ids); if (!c) throw notFound("Listing not found."); return c; },
      () => ({ audit: [{ action: "listing.removed", target: ids.join(", ") }], event: { name: "listings.listing.removed", payload: { codes: ids.join(", ") } } }));
    return { message: count > 1 ? `${count} listings deleted.` : "Listing deleted." };
  }

  // ───── Move to another business of the same person ─────
  async moveTargets(ctx: BusinessContext, code: string) {
    this.canList(ctx);
    const l = await this.own(ctx, code);
    return (await this.listings.memberships(ctx))
      .filter((m) => m.tenantId !== ctx.business.id && m.status === "active" && LISTING_PERMS.some((p) => hasPerm(m.role.perms, p)))
      .map((m) => ({ id: m.tenantId, name: m.tenant.name, type: m.tenant.type, plan: m.tenant.plan.name, allowed: this.kinds(m.tenant.type, m.tenant.plan).includes(l.kind as never) }));
  }

  async move(ctx: BusinessContext, code: string, raw: unknown) {
    this.canList(ctx);
    const l = await this.own(ctx, code);
    const { tenantId } = z.object({ tenantId: z.string().min(1).max(40) }).parse(raw);
    if (tenantId === ctx.business.id) throw badRequest("It's already in this business.");
    const target = (await this.listings.memberships(ctx)).find((m) => m.tenantId === tenantId && m.status === "active");
    if (!target || !LISTING_PERMS.some((p) => hasPerm(target.role.perms, p))) throw forbidden("You can only move listings into a business where you manage listings.");
    if (target.tenant.status === "suspended" || target.tenant.status === "cancelled") throw badRequest("That business isn't active.");
    if (!this.kinds(target.tenant.type, target.tenant.plan).includes(l.kind as never)) throw badRequest(`${target.tenant.name} can't list this kind of property on its plan.`);
    if (COUNTED.includes(l.status)) await this.room(ctx, tenantId, target.tenant.plan);
    // It lands in the other business's first open branch (its head office); it can be moved from there.
    const into = await this.listings.firstOpenBranch(ctx, tenantId);
    await this.write(ctx, (tx) => this.listings.moveBusiness(tx, l.id, tenantId, into?.id ?? null),
      () => ({ audit: [{ action: "listing.moved_out", target: l.code, meta: { to: tenantId } }, { action: "listing.moved_in", target: l.code, tenantId, meta: { from: ctx.business.id } }], event: { name: "listings.listing.moved", payload: { id: l.id, code: l.code, to: tenantId } } }));
    return { message: `Moved to ${target.tenant.name}.` };
  }
}
