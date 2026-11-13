// Listing check-ups on the kernel: every day each reviewer gets their own few listings to confirm, and what they change is decided together. Moved from
// business/backend/src/modules/reviews/checkups.ts in P2-W6 (it is listing data: MODEL-OWNERS.md); every rule, message and status code unchanged.
// Where it fits: CheckupController (Business → Listing check-ups, LiveCheckups.jsx) and checkupJob (decides yesterday's changes every 15 minutes).
// How it works:
// - The owner sets, per branch, who reviews (or everyone who manages listings there), how many a day per person, and what to review: listings added in
//   the last 1, 3, 6 or 12 months (or a custom range) and listings whose check date is within 1 week or 1, 2, 3 or 4 months (overdue ones always).
//   Saved in tenants.settings.checkups.
// - Each listing goes to one reviewer of its branch (spread evenly), so people never get the same listing on a day.
// - "All correct" moves the next check date; "Skip" does nothing else; both keep the listing on the website. A change takes the listing off the website
//   for the day (review_hold). At the end of the day (or when the owner presses "Decide now") each changed field takes the value most reviewers chose;
//   when no value wins, the owner picks. Then the listing is back on the website.
// - What each reviewer may change is set per person: High (everything), Medium (everything but the price), Low (details and other facts only) or a custom
//   choice of groups. The server refuses any change outside a person's groups.
// Each change runs in ONE transaction with its event; the owner's actions (setup, decide, pick) also write an audit line. A review is itself the history
// row (ListingReview), so it writes no audit line.
// Rules: a branch's reviews stay in that branch; staff see only their branches; the day is Nepal time.

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BusinessEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import { LISTING_PERMS } from "@sheetal/backend-core/domain/listings";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";
import { photoUrl } from "@sheetal/backend-core/lib/photos";
import { CheckupRepository, dbOf, type InView } from "./checkup.repository.js";

type Tx = Prisma.TransactionClient;
const SETTINGS_PERM = "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete";
/** Today in Nepal as YYYY-MM-DD. */
export const nepalDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(d);
const DAY = 864e5;
const RECENT: Record<string, number> = { "1m": 31, "3m": 92, "6m": 183, "1y": 366 };
const EXPIRING: Record<string, number> = { "1w": 7, "1m": 31, "2m": 62, "3m": 92, "4m": 123 };
/** Fields a reviewer may change, and how each is stored. */
const FIELDS: Record<string, "text" | "int" | "money" | "status"> = {
  propertyType: "text", title: "text", price: "money", status: "status", bedrooms: "int", bathrooms: "int", area: "text", district: "text",
  landArea: "text", builtArea: "text", roadAccess: "text", facing: "text", furnishing: "text", parking: "text",
};
/** Groups of fields, and which groups each access level may change. */
export const GROUPS: Record<string, string[]> = {
  price: ["price"], status: ["status"], details: ["title", "propertyType", "bedrooms", "bathrooms", "landArea", "builtArea"],
  location: ["area", "district", "roadAccess", "facing"], other: ["furnishing", "parking"],
};
const LEVELS: Record<string, string[]> = { high: Object.keys(GROUPS), medium: ["status", "details", "location", "other"], low: ["details", "other"] };
const Access = z.object({ level: z.enum(["high", "medium", "low", "custom"]), groups: z.array(z.enum(Object.keys(GROUPS) as [string, ...string[]])).max(10).optional() });
const Setup = z.object({
  perDay: z.number().int().min(1).max(50).default(5),
  recent: z.enum(["", "1m", "3m", "6m", "1y", "custom"]).default("1m"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiring: z.enum(["", "1w", "1m", "2m", "3m", "4m"]).default("1m"),
  extendMonths: z.number().int().min(1).max(24).default(3),
  reviewers: z.record(z.string().max(40), z.union([z.literal("all"), z.array(z.string().max(40)).max(200)])).default({}),
  access: z.record(z.string().max(40), Access).default({}),
}).partial();
const DEFAULTS = { perDay: 5, recent: "1m", expiring: "1m", extendMonths: 3, reviewers: {} as Record<string, "all" | string[]>, access: {} as Record<string, z.infer<typeof Access>> };
/** A person's level when the owner hasn't set one: owners High, managers Medium, everyone else Low. */
const defaultLevel = (perms: string[]) => (perms.includes("*") ? "high" : hasPerm(perms, SETTINGS_PERM) || hasPerm(perms, "crm.lead.assign") ? "medium" : "low");
const groupsOf = (a: z.infer<typeof Access> | undefined, perms: string[]) => (a?.level === "custom" ? a.groups ?? [] : LEVELS[a?.level ?? defaultLevel(perms)] ?? []);
const valueFor = (k: string, x: string): Prisma.ListingUpdateInput => {
  const t = FIELDS[k];
  if (t === "money") return { price: BigInt(Math.round(Number(x.replace(/[^\d.]/g, "")) || 0)) };
  if (t === "int") return { [k]: Math.round(Number(x)) || null } as Prisma.ListingUpdateInput;
  if (t === "status") return ["published", "sold", "rented"].includes(x) ? { status: x as "published" } : {};
  return { [k]: x } as Prisma.ListingUpdateInput;
};
const repo = new CheckupRepository();

/** Takes the votes of the day's changes and applies the winners; a field with no winner is left for the owner. Runs in the caller's transaction. */
export async function decideChanges(d: Tx, tenantId: string, before: string | null) {
  const reviews = await repo.undecided(d, tenantId, before);
  const byListing = new Map<number, typeof reviews>();
  for (const r of reviews) byListing.set(r.listingId, [...(byListing.get(r.listingId) ?? []), r]);
  let applied = 0, conflicts = 0;
  for (const [listingId, list] of byListing) {
    const votes = new Map<string, Map<string, string[]>>();
    for (const r of list) for (const [k, x] of Object.entries(r.changes as Record<string, unknown>)) {
      const m = votes.get(k) ?? new Map<string, string[]>(); m.set(String(x), [...(m.get(String(x)) ?? []), r.userId]); votes.set(k, m);
    }
    const data: Prisma.ListingUpdateInput = {};
    const open: Record<string, { value: string; by: string[] }[]> = {};
    for (const [k, m] of votes) {
      const ranked = [...m].sort((a, b) => b[1].length - a[1].length);
      const [top, second] = ranked;
      if (top && (!second || top[1].length > second[1].length)) Object.assign(data, valueFor(k, top[0]));
      else open[k] = ranked.map(([value, by]) => ({ value, by }));
    }
    const conflict = Object.keys(open).length ? open : null;
    await repo.changeListing(d, listingId, { ...data, reviewHold: !!conflict, reviewConflict: conflict ? (conflict as Prisma.InputJsonValue) : Prisma.DbNull });
    await repo.markDecided(d, list.map((r) => r.id));
    if (conflict) conflicts++; else applied++;
  }
  return { applied, conflicts };
}

class CheckupBase extends BaseRepository<BusinessEntity, never, never> {
  constructor() { super({ model: "listingReview", branchField: "branchId", ownerField: null, label: "This review", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
}
export interface CheckupDeps { bus: EventBus; mediaBase: string }

export class CheckupService extends BaseService<BusinessEntity, never, never> {
  readonly repo = repo;
  constructor(private readonly x: CheckupDeps) {
    super({ app: "listings", resource: "checkup", repo: new CheckupBase(), permissions: { read: SETTINGS_PERM, create: SETTINGS_PERM, update: SETTINGS_PERM, delete: SETTINGS_PERM },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "checkup", label: (r) => r.id }, bus: x.bus, requireVersion: false });
  }
  private inView(ctx: BusinessContext): InView { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; }
  private canManage(ctx: BusinessContext) { return ctx.permissions.can(SETTINGS_PERM) || ctx.permissions.can("crm.lead.assign"); }
  private async setupOf(d: Tx, tenantId: string) {
    const s = (await repo.settings(d, tenantId)).checkups;
    return { ...DEFAULTS, ...Setup.parse(s && typeof s === "object" ? s : {}) };
  }
  /** People who may review in each branch: chosen ones, or everyone with a listing role there. */
  private async reviewersByBranch(d: Tx, tenantId: string, setup: { reviewers?: Record<string, "all" | string[]> }) {
    const [branches, members] = await repo.branchesAndTeam(d, tenantId);
    const lists = (m: (typeof members)[number]) => LISTING_PERMS.some((p) => hasPerm(m.role.perms, p));
    const inBranch = (m: (typeof members)[number], name: string) => m.role.perms.includes("*") || !Array.isArray(m.scopes) || (m.scopes as unknown as string[]).includes(name);
    return new Map(branches.map((b) => {
      const pool = members.filter((m) => inBranch(m, b.name));
      const chosen = setup.reviewers?.[b.id];
      const list = Array.isArray(chosen) ? pool.filter((m) => chosen.includes(m.userId)) : pool.filter(lists);
      return [b.id, { name: b.name, pool: pool.map((m) => ({ id: m.userId, name: m.user.userName, role: m.role.name || m.role.key.replace(/_/g, " "), lists: lists(m), perms: m.role.perms })), ids: list.map((m) => m.userId).sort() }];
    }));
  }
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, audit: ((r: R) => { action: string; target: string }) | null, event: (r: R) => { name: string; payload: object; branchId?: string | null }): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      if (audit) { const a = audit(r); await this.writeAudit(tx, a.action, a.target); }
      const e = event(r);
      await this.deps.bus.publish(tx, e.name, e.payload, 1, { branchId: e.branchId ?? null });
      return r;
    });
  }

  // ───── Setup (owners and managers) ─────
  async setup(ctx: BusinessContext) {
    const d = dbOf(ctx);
    const setup = await this.setupOf(d, ctx.business.id);
    const by = await this.reviewersByBranch(d, ctx.business.id, setup);
    return { setup, canManage: this.canManage(ctx), groups: GROUPS, levels: LEVELS, branches: ctx.branches.mine.map((b) => ({ id: b.id, name: b.name, reviewers: setup.reviewers?.[b.id] ?? "all",
      people: (by.get(b.id)?.pool ?? []).map(({ perms, ...p }) => ({ ...p, level: setup.access?.[p.id]?.level ?? defaultLevel(perms), groups: groupsOf(setup.access?.[p.id], perms) })) })) };
  }
  async saveSetup(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    if (!this.canManage(ctx)) throw forbidden("Only owners and managers change check-ups.");
    const next = Setup.parse(raw);
    await this.write(ctx, async (tx) => {
      const all = await repo.settings(dbOf(tx), ctx.business.id);
      await repo.saveSettings(dbOf(tx), ctx.business.id, { ...all, checkups: { ...((all.checkups as object) ?? {}), ...next } });
    }, () => ({ action: "checkups.setup", target: "check-ups" }), () => ({ name: "listings.checkup.setup_saved", payload: { id: ctx.business.id } }));
    return { message: "Check-up settings saved." };
  }

  // ───── Today's list for the person asking ─────
  async today(ctx: BusinessContext) {
    const d = dbOf(ctx), me = ctx.member.userId;
    const day = nepalDay();
    const setup = await this.setupOf(d, ctx.business.id);
    const by = await this.reviewersByBranch(d, ctx.business.id, setup);
    if (![...by.values()].some((b) => b.ids.includes(me))) throw forbidden("You aren't a reviewer in any branch. Ask the owner to add you in Check-ups → Settings.");
    const now = Date.now();
    const or: Prisma.ListingWhereInput[] = [{ checkDueAt: { lt: new Date(now) } }];
    if (setup.expiring) or.push({ checkDueAt: { lte: new Date(now + EXPIRING[setup.expiring]! * DAY) } });
    if (setup.recent === "custom" && setup.from) or.push({ createdAt: { gte: new Date(setup.from), ...(setup.to ? { lte: new Date(`${setup.to}T23:59:59Z`) } : {}) } });
    else if (setup.recent && RECENT[setup.recent]) or.push({ createdAt: { gte: new Date(now - RECENT[setup.recent]! * DAY) } });
    const [rows, doneToday, mine] = await repo.toReview(ctx, this.inView(ctx), or, day, me);
    const reviewed = new Set(doneToday.map((r) => r.listingId));
    const left = Math.max(0, setup.perDay - mine);
    const list = rows.filter((l) => {
      if (reviewed.has(l.id) || !l.branchId) return false;
      const ids = by.get(l.branchId)?.ids ?? [];
      return ids.length > 0 && ids[l.id % ids.length] === me;
    }).slice(0, left);
    const allowed = groupsOf(setup.access?.[me], await repo.rolePerms(d, ctx.business.id, ctx.member.roleId));
    return { day, perDay: setup.perDay, done: mine, groups: Object.fromEntries(allowed.map((g) => [g, GROUPS[g]])), listings: list.map((l) => ({
      id: l.code, title: l.title, propertyType: l.propertyType, status: l.status, price: l.price == null ? null : Number(l.price), area: l.area, district: l.district,
      bedrooms: l.bedrooms, bathrooms: l.bathrooms, landArea: l.landArea, builtArea: l.builtArea, roadAccess: l.roadAccess, facing: l.facing, furnishing: l.furnishing, parking: l.parking,
      checkDue: l.checkDueAt?.toISOString().slice(0, 10) ?? null, added: l.createdAt.toISOString().slice(0, 10), photo: l.photos[0] ? photoUrl(this.x.mediaBase, "thumbnail", l.photos[0].file) : null, held: l.reviewHold,
    })) };
  }

  // ───── A review ─────
  async review(ctx: BusinessContext, code: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    const d = dbOf(ctx), me = ctx.member.userId;
    const b = z.object({ action: z.enum(["ok", "change", "skip"]), changes: z.record(z.string(), z.union([z.string().max(300), z.number()])).default({}) }).parse(raw);
    const l = await repo.listing(ctx, code, this.inView(ctx));
    if (!l) throw notFound("Listing not found.");
    const setup = await this.setupOf(d, ctx.business.id);
    const by = await this.reviewersByBranch(d, ctx.business.id, setup);
    if (!l.branchId || !by.get(l.branchId)?.ids.includes(me)) throw forbidden("You aren't a reviewer at this listing's branch.");
    const may = new Set(groupsOf(setup.access?.[me], await repo.rolePerms(d, ctx.business.id, ctx.member.roleId)).flatMap((g) => GROUPS[g] ?? []));
    const changes = Object.fromEntries(Object.entries(b.changes).filter(([k, x]) => FIELDS[k] && String(x).trim() !== ""));
    const refused = Object.keys(changes).filter((k) => !may.has(k));
    if (refused.length) throw forbidden(`You can't change: ${refused.join(", ")}. Ask the owner for more access.`);
    if (b.action === "change" && !Object.keys(changes).length) throw badRequest("Change at least one field, or choose All correct.");
    const day = nepalDay();
    await this.write(ctx, async (tx) => {
      const r = await repo.addReview(tx, { branchId: l.branchId, listingId: l.id, userId: me, day, action: b.action, changes: changes as Prisma.InputJsonValue });
      if (b.action === "ok") await repo.changeListing(dbOf(tx), l.id, { lastCheckedAt: new Date(), lastCheckedBy: me, checkDueAt: new Date(Date.now() + setup.extendMonths * 30.5 * DAY) });
      if (b.action === "change") await repo.changeListing(dbOf(tx), l.id, { reviewHold: true, lastCheckedAt: new Date(), lastCheckedBy: me });
      return r;
    }, null, (r) => ({ name: "listings.checkup.reviewed", payload: { id: r.id, action: b.action }, branchId: l.branchId }));
    return { message: b.action === "change" ? "Saved. The listing is off the website until today's changes are decided." : b.action === "ok" ? "Thanks, marked as correct." : "Skipped." };
  }

  // ───── Deciding the changes ─────
  async decideNow(ctx: BusinessContext) {
    this.refuseReadOnly(ctx);
    if (!this.canManage(ctx)) throw forbidden("Only owners and managers decide check-up changes.");
    const r = await this.write(ctx, (tx) => decideChanges(dbOf(tx), ctx.business.id, null), (r) => ({ action: "checkups.decided", target: `${r.applied} applied, ${r.conflicts} to choose` }),
      (r) => ({ name: "listings.checkup.decided", payload: { applied: r.applied, conflicts: r.conflicts } }));
    return { message: `${r.applied} listings updated and back on the website${r.conflicts ? `, ${r.conflicts} need your choice` : ""}.`, data: r };
  }
  async conflicts(ctx: BusinessContext) {
    const rows = await repo.conflicts(ctx, this.inView(ctx));
    const ids = [...new Set(rows.flatMap((l) => Object.values((l.reviewConflict ?? {}) as Record<string, { by: string[] }[]>).flatMap((o) => o.flatMap((x) => x.by))))];
    const names = new Map((await repo.userNames(ctx, ids)).map((u) => [u.id, u.userName]));
    return rows.filter((l) => l.reviewConflict).map((l) => ({ id: l.code, title: l.title, choices: Object.fromEntries(Object.entries(l.reviewConflict as Record<string, { value: string; by: string[] }[]>).map(([k, o]) => [k, o.map((x) => ({ value: x.value, by: x.by.map((u) => names.get(u) ?? "Team member") }))])) }));
  }
  async pick(ctx: BusinessContext, code: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    if (!this.canManage(ctx)) throw forbidden("Only owners and managers decide check-up changes.");
    const picks = z.record(z.string(), z.string().max(300)).parse(raw);
    const l = await repo.listing(ctx, code, {});
    if (!l) throw notFound("Listing not found.");
    const data: Prisma.ListingUpdateInput = {};
    for (const [k, x] of Object.entries(picks)) if (FIELDS[k]) Object.assign(data, valueFor(k, x));
    await this.write(ctx, (tx) => repo.changeListing(dbOf(tx), l.id, { ...data, reviewHold: false, reviewConflict: Prisma.DbNull }),
      () => ({ action: "checkups.picked", target: l.code }), () => ({ name: "listings.checkup.picked", payload: { id: l.id }, branchId: l.branchId }));
    return { message: "Saved. The listing is back on the website." };
  }

  // ───── History: who reviewed, skipped or changed what ─────
  async history(ctx: BusinessContext, rawQuery: unknown) {
    const q = z.object({ days: z.coerce.number().int().min(1).max(400).default(30) }).parse(rawQuery);
    const since = nepalDay(new Date(Date.now() - q.days * DAY));
    const rows = await repo.history(ctx, since, ctx.branches.idsFor("branch"));
    const [users, listings] = await Promise.all([repo.userNames(ctx, [...new Set(rows.map((r) => r.userId))]), repo.listingTitles(ctx, [...new Set(rows.map((r) => r.listingId))])]);
    const U = new Map(users.map((u) => [u.id, u.userName])), L = new Map(listings.map((l) => [l.id, l]));
    return rows.map((r) => ({ id: r.id, day: r.day, at: r.createdAt.toISOString(), by: U.get(r.userId) ?? "Team member", listing: L.get(r.listingId)?.code, title: L.get(r.listingId)?.title, action: r.action, changes: r.changes, decided: r.decided }));
  }
}
