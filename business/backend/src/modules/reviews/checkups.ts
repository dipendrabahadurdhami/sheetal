// Listing reviews (check-ups) per branch: every day each reviewer gets their own few listings to confirm, and what
// they change is decided together.
// Where it fits: Business → Listing check-ups (LiveCheckups.jsx) for signed-in businesses.
// How it works:
// - The owner sets, per branch, who reviews (or everyone who manages listings there), how many a day per person, and
//   what to review: listings added in the last 1, 3, 6 or 12 months (or a custom range) and listings whose check date
//   is within 1 week or 1, 2, 3 or 4 months (overdue ones always). Saved in tenants.settings.checkups.
// - Each listing goes to one reviewer of its branch (spread evenly), so people never get the same listing on a day.
// - "All correct" moves the next check date; "Skip" does nothing else; both keep the listing on the website.
//   A change (price, title, rooms, status…) takes the listing off the website for the day (review_hold) while the
//   team keeps working on it. At the end of the day (or when the owner presses "Decide now") each changed field takes
//   the value most reviewers chose; when no value wins, the owner picks. Then the listing is back on the website.
// - Every review is kept: who reviewed, skipped or changed what, and what was decided.
// - What each reviewer may change is set per person: High (everything), Medium (everything but the price), Low (details
//   and other facts only) or a custom choice of groups (price, status, details, location, other). The server refuses
//   any change outside a person's groups. Anyone in the branch can be made a reviewer, even without a listing role.
// Rules: a branch's reviews stay in that branch; staff see only their branches (inView); the day is Nepal time.

import type { FastifyInstance } from "fastify";
import { type JobSpec } from "@sheetal/platform/jobs/registry";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf, type Db } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { LISTING_PERMS } from "@sheetal/backend-core/domain/listings";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";
import { branchView, inView, workspaceOf, type Workspace } from "../access.js";
import { mediaBase, photoUrl } from "@sheetal/backend-core/lib/photos";

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
type SetupT = z.infer<typeof Setup>;
const DEFAULTS = { perDay: 5, recent: "1m", expiring: "1m", extendMonths: 3, reviewers: {} as Record<string, "all" | string[]>, access: {} as Record<string, z.infer<typeof Access>> };
/** A person's level when the owner hasn't set one: owners High, managers Medium, everyone else Low. */
const defaultLevel = (perms: string[]) => (perms.includes("*") ? "high" : hasPerm(perms, "settings.business") || hasPerm(perms, "leads.assign") ? "medium" : "low");
const groupsOf = (a: z.infer<typeof Access> | undefined, perms: string[]) => (a?.level === "custom" ? a.groups ?? [] : LEVELS[a?.level ?? defaultLevel(perms)] ?? []);

/** Takes the votes of the day's changes and applies the winners; a field with no winner is left for the owner. */
export async function decideChanges(db: Db, tenantId: string, before: string | null) {
  const reviews = await db.listingReview.findMany({ where: { tenantId, action: "change", decided: false, ...(before ? { day: { lt: before } } : {}) } });
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
    await db.listing.update({ where: { id: listingId }, data: { ...data, reviewHold: !!conflict, reviewConflict: conflict ? (conflict as Prisma.InputJsonValue) : Prisma.DbNull } });
    await db.listingReview.updateMany({ where: { id: { in: list.map((r) => r.id) } }, data: { decided: true } });
    if (conflict) conflicts++; else applied++;
  }
  return { applied, conflicts };
}

const valueFor = (k: string, x: string): Prisma.ListingUpdateInput => {
  const t = FIELDS[k];
  if (t === "money") return { price: BigInt(Math.round(Number(x.replace(/[^\d.]/g, "")) || 0)) };
  if (t === "int") return { [k]: Math.round(Number(x)) || null } as Prisma.ListingUpdateInput;
  if (t === "status") return ["published", "sold", "rented"].includes(x) ? { status: x as "published" } : {};
  return { [k]: x } as Prisma.ListingUpdateInput;
};

export async function reviewRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const setupOf = async (tenantId: string) => {
    const t = await db().tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const s = ((t?.settings ?? {}) as Record<string, unknown>).checkups;
    return { ...DEFAULTS, ...Setup.parse(s && typeof s === "object" ? s : {}) };
  };
  /** People who may review in each branch: chosen ones, or everyone with a listing role there. */
  async function reviewersByBranch(tenantId: string, setup: { reviewers?: Record<string, "all" | string[]> }) {
    const [branches, members] = await Promise.all([
      db().branch.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      db().membership.findMany({ where: { tenantId, status: "active" }, include: { role: true, user: { select: { id: true, userName: true } } } }),
    ]);
    const can = members;
    const lists = (m: (typeof can)[number]) => LISTING_PERMS.some((p) => hasPerm(m.role.perms, p));
    const inBranch = (m: (typeof can)[number], name: string) => m.role.perms.includes("*") || !Array.isArray(m.scopes) || (m.scopes as unknown as string[]).includes(name);
    return new Map(branches.map((b) => {
      const pool = can.filter((m) => inBranch(m, b.name));
      const chosen = setup.reviewers?.[b.id];
      const list = Array.isArray(chosen) ? pool.filter((m) => chosen.includes(m.userId)) : pool.filter(lists);
      return [b.id, { name: b.name, pool: pool.map((m) => ({ id: m.userId, name: m.user.userName, role: m.role.name || m.role.key.replace(/_/g, " "), lists: lists(m), perms: m.role.perms })), ids: list.map((m) => m.userId).sort() }];
    }));
  }
  const canManage = (ws: Workspace) => ws.can("settings.business") || ws.can("leads.assign");

  // ───── Setup (owners and managers) ─────
  app.get("/checkups/setup", async (request) => {
    const ws = workspaceOf(request);
    const setup = await setupOf(ws.tenantId);
    const by = await reviewersByBranch(ws.tenantId, setup);
    const v = await branchView(db(), request, ws);
    return { data: { setup, canManage: canManage(ws), groups: GROUPS, levels: LEVELS, branches: v.mine.map((b) => ({ id: b.id, name: b.name, reviewers: setup.reviewers?.[b.id] ?? "all",
      people: (by.get(b.id)?.pool ?? []).map(({ perms, ...p }) => ({ ...p, level: setup.access?.[p.id]?.level ?? defaultLevel(perms), groups: groupsOf(setup.access?.[p.id], perms) })) })) } };
  });
  app.put("/checkups/setup", async (request) => {
    const ws = workspaceOf(request);
    if (!canManage(ws)) throw forbidden("Only owners and managers change check-ups.");
    const next = Setup.parse(request.body);
    const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { settings: true } });
    const all = (t.settings ?? {}) as Record<string, unknown>;
    await db().tenant.update({ where: { id: ws.tenantId }, data: { settings: { ...all, checkups: { ...((all.checkups as object) ?? {}), ...next } } as Prisma.InputJsonValue } });
    return { message: "Check-up settings saved." };
  });

  // ───── Today's list for the person asking ─────
  app.get("/checkups/today", async (request) => {
    const ws = workspaceOf(request);
    const day = nepalDay();
    const setup = await setupOf(ws.tenantId);
    const by = await reviewersByBranch(ws.tenantId, setup);
    if (![...by.values()].some((b) => b.ids.includes(ws.user.id))) throw forbidden("You aren't a reviewer in any branch. Ask the owner to add you in Check-ups → Settings.");
    const v = await branchView(db(), request, ws);
    const now = Date.now();
    const or: Prisma.ListingWhereInput[] = [{ checkDueAt: { lt: new Date(now) } }];
    if (setup.expiring) or.push({ checkDueAt: { lte: new Date(now + EXPIRING[setup.expiring]! * DAY) } });
    if (setup.recent === "custom" && setup.from) or.push({ createdAt: { gte: new Date(setup.from), ...(setup.to ? { lte: new Date(`${setup.to}T23:59:59Z`) } : {}) } });
    else if (setup.recent && RECENT[setup.recent]) or.push({ createdAt: { gte: new Date(now - RECENT[setup.recent]! * DAY) } });
    const [rows, doneToday, mine] = await Promise.all([
      db().listing.findMany({ where: { tenantId: ws.tenantId, status: { in: ["published", "sold", "rented", "paused"] }, ...inView(v), OR: or }, include: { photos: { orderBy: { sort: "asc" }, take: 1 } }, orderBy: [{ checkDueAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 2000 }),
      db().listingReview.findMany({ where: { tenantId: ws.tenantId, day }, select: { listingId: true } }),
      db().listingReview.count({ where: { tenantId: ws.tenantId, day, userId: ws.user.id } }),
    ]);
    const reviewed = new Set(doneToday.map((r) => r.listingId));
    const left = Math.max(0, setup.perDay - mine);
    const list = rows.filter((l) => {
      if (reviewed.has(l.id) || !l.branchId) return false;
      const ids = by.get(l.branchId)?.ids ?? [];
      return ids.length > 0 && ids[l.id % ids.length] === ws.user.id;
    }).slice(0, left);
    const allowed = groupsOf(setup.access?.[ws.user.id], ws.member.role.perms);
    return { data: { day, perDay: setup.perDay, done: mine, groups: Object.fromEntries(allowed.map((g) => [g, GROUPS[g]])), listings: list.map((l) => ({
      id: l.code, title: l.title, propertyType: l.propertyType, status: l.status, price: l.price == null ? null : Number(l.price), area: l.area, district: l.district,
      bedrooms: l.bedrooms, bathrooms: l.bathrooms, landArea: l.landArea, builtArea: l.builtArea, roadAccess: l.roadAccess, facing: l.facing, furnishing: l.furnishing, parking: l.parking,
      checkDue: l.checkDueAt?.toISOString().slice(0, 10) ?? null, added: l.createdAt.toISOString().slice(0, 10), photo: l.photos[0] ? photoUrl(mediaBase(app.config), "thumbnail", l.photos[0].file) : null, held: l.reviewHold,
    })) } };
  });

  // ───── A review ─────
  app.post<{ Params: { code: string } }>("/checkups/review/:code", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({ action: z.enum(["ok", "change", "skip"]), changes: z.record(z.string(), z.union([z.string().max(300), z.number()])).default({}) }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const l = await db().listing.findFirst({ where: { code: request.params.code.slice(0, 40), tenantId: ws.tenantId, ...inView(v) } });
    if (!l) throw notFound("Listing not found.");
    const setupNow = await setupOf(ws.tenantId);
    const by = await reviewersByBranch(ws.tenantId, setupNow);
    if (!l.branchId || !by.get(l.branchId)?.ids.includes(ws.user.id)) throw forbidden("You aren't a reviewer at this listing's branch.");
    const may = new Set(groupsOf(setupNow.access?.[ws.user.id], ws.member.role.perms).flatMap((g) => GROUPS[g] ?? []));
    const changes = Object.fromEntries(Object.entries(b.changes).filter(([k, x]) => FIELDS[k] && String(x).trim() !== ""));
    const refused = Object.keys(changes).filter((k) => !may.has(k));
    if (refused.length) throw forbidden(`You can't change: ${refused.join(", ")}. Ask the owner for more access.`);
    if (b.action === "change" && !Object.keys(changes).length) throw badRequest("Change at least one field, or choose All correct.");
    const day = nepalDay();
    await db().listingReview.create({ data: { tenantId: ws.tenantId, branchId: l.branchId, listingId: l.id, userId: ws.user.id, day, action: b.action, changes: changes as Prisma.InputJsonValue } });
    const setup = await setupOf(ws.tenantId);
    if (b.action === "ok") await db().listing.update({ where: { id: l.id }, data: { lastCheckedAt: new Date(), lastCheckedBy: ws.user.id, checkDueAt: new Date(Date.now() + setup.extendMonths * 30.5 * DAY) } });
    if (b.action === "change") await db().listing.update({ where: { id: l.id }, data: { reviewHold: true, lastCheckedAt: new Date(), lastCheckedBy: ws.user.id } });
    return { message: b.action === "change" ? "Saved. The listing is off the website until today's changes are decided." : b.action === "ok" ? "Thanks, marked as correct." : "Skipped." };
  });

  // ───── Deciding the changes ─────
  const decide = (tenantId: string, before: string | null) => decideChanges(db(), tenantId, before);

  app.post("/checkups/decide", async (request) => {
    const ws = workspaceOf(request);
    if (!canManage(ws)) throw forbidden("Only owners and managers decide check-up changes.");
    const r = await decide(ws.tenantId, null);
    return { message: `${r.applied} listings updated and back on the website${r.conflicts ? `, ${r.conflicts} need your choice` : ""}.`, data: r };
  });

  app.get("/checkups/conflicts", async (request) => {
    const ws = workspaceOf(request);
    const v = await branchView(db(), request, ws);
    const rows = await db().listing.findMany({ where: { tenantId: ws.tenantId, reviewHold: true, reviewConflict: { not: Prisma.DbNull }, ...inView(v) }, take: 200 });
    const ids = [...new Set(rows.flatMap((l) => Object.values((l.reviewConflict ?? {}) as Record<string, { by: string[] }[]>).flatMap((o) => o.flatMap((x) => x.by))))];
    const names = new Map((await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    return { data: rows.filter((l) => l.reviewConflict).map((l) => ({ id: l.code, title: l.title, choices: Object.fromEntries(Object.entries(l.reviewConflict as Record<string, { value: string; by: string[] }[]>).map(([k, o]) => [k, o.map((x) => ({ value: x.value, by: x.by.map((u) => names.get(u) ?? "Team member") }))])) })) };
  });
  app.post<{ Params: { code: string } }>("/checkups/conflicts/:code", async (request) => {
    const ws = workspaceOf(request);
    if (!canManage(ws)) throw forbidden("Only owners and managers decide check-up changes.");
    const picks = z.record(z.string(), z.string().max(300)).parse(request.body);
    const l = await db().listing.findFirst({ where: { code: request.params.code.slice(0, 40), tenantId: ws.tenantId } });
    if (!l) throw notFound("Listing not found.");
    const data: Prisma.ListingUpdateInput = {};
    for (const [k, x] of Object.entries(picks)) if (FIELDS[k]) Object.assign(data, valueFor(k, x));
    await db().listing.update({ where: { id: l.id }, data: { ...data, reviewHold: false, reviewConflict: Prisma.DbNull } });
    return { message: "Saved. The listing is back on the website." };
  });

  // ───── History: who reviewed, skipped or changed what ─────
  app.get("/checkups/history", async (request) => {
    const ws = workspaceOf(request);
    const q = z.object({ days: z.coerce.number().int().min(1).max(400).default(30) }).parse(request.query);
    const v = await branchView(db(), request, ws);
    const since = nepalDay(new Date(Date.now() - q.days * DAY));
    const rows = await db().listingReview.findMany({ where: { tenantId: ws.tenantId, day: { gte: since }, ...(v.ids ? { branchId: { in: v.ids } } : {}) }, orderBy: { createdAt: "desc" }, take: 1000 });
    const [users, listings] = await Promise.all([
      db().user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, userName: true } }),
      db().listing.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.listingId))] } }, select: { id: true, code: true, title: true } }),
    ]);
    const U = new Map(users.map((u) => [u.id, u.userName])), L = new Map(listings.map((l) => [l.id, l]));
    return { data: rows.map((r) => ({ id: r.id, day: r.day, at: r.createdAt.toISOString(), by: U.get(r.userId) ?? "Team member", listing: L.get(r.listingId)?.code, title: L.get(r.listingId)?.title, action: r.action, changes: r.changes, decided: r.decided })) };
  });
  // Yesterday's (and older) changes are decided on their own every 15 minutes: see reviewCheckupJob() below (jobs registry).
}

/** Decides yesterday's (and older) changes on their own, every 15 minutes, in the business API. No first run at start: the first run is after 15 minutes, as before. */
export const reviewCheckupJob = (app: FastifyInstance): JobSpec => ({
  id: "reviews.checkups", everyMs: 15 * 60 * 1000, firstRunMs: null,
  run: async () => {
    const db = dbOf(app);
    const today = nepalDay();
    const tenants = await db.listingReview.findMany({ where: { action: "change", decided: false, day: { lt: today } }, distinct: ["tenantId"], select: { tenantId: true } });
    for (const t of tenants) await decideChanges(db, t.tenantId, today).catch((e) => app.log.error(e, "checkup decide failed"));
  },
});
