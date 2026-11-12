// The tenancy context: builds the BusinessContext (and the StaffContext) of a request.
// Where it fits: platform/src/core/context.ts holds the TYPES; this file builds the real objects from the signed-in person, the
// "x-tenant-id" and "x-branch" headers and today's plan. Controllers pass it in as `contextOf` (core/controller.ts); the business API's
// old access.ts adapter uses the small pure builders below (branch scope, permission set) so that every old route keeps working.
// How it works:
//   buildBusinessContext()      session user + headers -> BusinessContext (member, branch scope by branch ID, permission set, entitlements)
//   buildStaffContext()         Sheetal staff (platform role from PLATFORM_ROLES) -> StaffContext for the admin API
//   buildImpersonationContext() staff "logging in as" a business -> BusinessContext with actor = staff, read-only unless write mode
//   createBranchScope()         pure: the branches a person may use, the picked one, idsFor(), branchForNew(), canSee()
//   buildPermissionSet()        pure: grants like "expenses.expense.read:branch" or old names ("expenses.view"), through the alias layer
//   buildEntitlements()         pure: today's plan and business type -> hasApp, limit, feature, seats
//   requireAppAccess()          the two refusals of ACCESS.md section 7: app_not_available, and "your role can't use it"
// Rules: nothing here writes to the database. This file never imports backend-core (it would be a circle); the one thing it needs from
// there, effectiveLimits() (plan limits plus bought add-ons), is passed in as `deps`. Phase 1 changes no answer: hasApp is true for every app
// offered to the business type (or all of them on a plan with "all_kinds"), limits and seats are today's, and every old permission keeps
// the data scope it has today ("branch" for data, "all" for team, roles, settings, billing).

import type { FastifyBaseLogger } from "fastify";
import { AppError, badRequest, forbidden, notFound } from "../core/errors.js";
import {
  narrowest, type BranchInfo, type BranchScope, type BusinessContext, type DataScope, type Entitlements, type PermissionId, type PermissionSet,
  type StaffContext, type Tx,
} from "../core/context.js";
import type { Db } from "../db/client.js";
import { APPS } from "./apps.generated.js";
import { hasPerm, newNamesOf } from "./aliases.js";
import { LEGACY_PLATFORM_ROLES, PERMISSION_CATALOG } from "./permissions.generated.js";

// ───────────── Input shapes (structural, so the Prisma session user fits without importing backend-core) ─────────────

export interface MembershipLike {
  id: string; userId: string; tenantId: string; roleId: string; status: string;
  /** The OLD branch access ("all", or a list of branch names). Only used when the new fields are missing. */
  scopes: unknown;
  /** The new way (P1-DB-2): true = every branch; false = only the rows in `branches`. */
  allBranches?: boolean;
  branches?: readonly { branchId: string; branch?: { name: string } }[];
  role: { id: string; key: string; perms: string[] };
  tenant: { id: string; name: string; type: string; status: string; planId: string; plan: PlanLike };
}
export interface PlanLike { id: string; price: number; limits: unknown; features: unknown }
export interface SessionUserLike { id: string; userName: string; platformRole?: string | null; memberships: readonly MembershipLike[] }

export type Headers = Record<string, string | string[] | undefined>;

export interface RequestInfo {
  db: Db;
  headers: Headers;
  ip: string;
  requestId: string;
  log: FastifyBaseLogger;
  /** Fixed for the whole request; tests can set it. */
  now?: Date;
}

/** What the builder needs from backend-core (passed in, never imported). */
export interface TenancyDeps {
  /** domain/addons.ts effectiveLimits(): the plan with its limits raised by bought add-ons. */
  effectiveLimits(db: Db, tenantId: string, plan: PlanLike): Promise<{ limits: unknown }>;
}

const header = (h: Headers, name: string): string | undefined => {
  const v = h[name];
  return typeof v === "string" && v ? v : undefined;
};

// ───────────── Permissions ─────────────

const RANK: Record<DataScope, number> = { own: 0, branch: 1, all: 2 };
const isScope = (s: string): s is DataScope => s === "own" || s === "branch" || s === "all";
const CATALOG = new Map(PERMISSION_CATALOG.map((p) => [p.id, p]));

/** The scope a grant without a suffix gets: the manifest default; for an OLD name, the narrowest default of the new names it stands for. */
function defaultScope(name: string): DataScope {
  const own = CATALOG.get(name)?.default;
  if (own) return own;
  let best: DataScope | null = null;
  for (const n of newNamesOf(name)) {
    const d = CATALOG.get(n)?.default;
    if (d && (best === null || RANK[d] < RANK[best])) best = d;
  }
  return best ?? "all";
}

/** The scope this exact name is held at ("name" or "name:scope"), the widest if it is listed twice; null when not held. */
function heldScope(perms: readonly string[], name: string): DataScope | null {
  let best: DataScope | null = null;
  for (const p of perms) {
    let s: DataScope | null = null;
    if (p === name) s = defaultScope(name);
    else if (p.length > name.length && p.startsWith(name) && p.charCodeAt(name.length) === 58) {   // 58 = ":"
      const suffix = p.slice(name.length + 1);
      s = isScope(suffix) ? suffix : defaultScope(name);
    }
    if (s && (best === null || RANK[s] > RANK[best])) best = s;
  }
  return best;
}

/** A PermissionSet over a role's stored permission list (old names, new names, with or without ":scope", or "*"). */
export function buildPermissionSet(perms: readonly string[]): PermissionSet {
  const scopeOf = (perm: PermissionId): DataScope | null => {
    if (perms.includes("*")) return "all";
    if (perm.includes("+")) {
      // Several names joined with "+": all are needed, and the scope is the narrowest of them (see hasPerm in aliases.ts).
      const parts = perm.split("+").map((p) => (p ? scopeOf(p) : null));
      return parts.some((x) => x === null) ? null : (parts as DataScope[]).reduce(narrowest);
    }
    const direct = heldScope(perms, perm);
    if (direct) return direct;
    if (!hasPerm(perms, perm)) return null;
    // Reached through the alias layer: an old name held for a new one, or all the new names held for an old one.
    const through = newNamesOf(perm).map((n) => heldScope(perms, n)).filter((s): s is DataScope => s !== null);
    return through.length ? through.reduce(narrowest) : defaultScope(perm);
  };
  return {
    can: (perm) => hasPerm(perms, perm),
    scopeOf,
    require(perm, message) {
      const s = scopeOf(perm);
      if (!s) throw forbidden(message ?? "You don't have permission to do that.");
      return s;
    },
    canAny: (list) => list.some((p) => hasPerm(perms, p)),
  };
}

/** What a read-only or write-mode support session may never do (ACCESS.md section 12), even with the owner's "*". */
export const IMPERSONATION_DENY = [
  "workspace.role.*", "workspace.team.invite", "workspace.team.update", "workspace.team.remove", "workspace.billing.manage", "workspace.settings.update",
];
/** Whether a permission is on the fixed deny list of a support session (also through the alias layer: an old name counts when one of its new names is denied). */
export const deniedInSupport = (perm: string) => [perm, ...newNamesOf(perm)].some((n) => IMPERSONATION_DENY.some((d) => (d.endsWith(".*") ? n.startsWith(d.slice(0, -1)) : n === d)));

/** The permission set of a support session: the owner role minus the fixed deny list. */
export function buildImpersonationPermissions(): PermissionSet {
  const owner = buildPermissionSet(["*"]);
  return {
    can: (p) => !deniedInSupport(p) && owner.can(p),
    scopeOf: (p) => (deniedInSupport(p) ? null : owner.scopeOf(p)),
    require(p, message) {
      if (deniedInSupport(p)) throw forbidden(message ?? "Sheetal support sessions can't do this.");
      return owner.require(p, message);
    },
    canAny: (list) => list.some((p) => !deniedInSupport(p) && owner.can(p)),
  };
}

// ───────────── Branch scope ─────────────

/** What a membership allows: every branch, or a list of branch ids (and the same as names, for the old screens). Owners are always "all". */
export interface BranchAccess { allowed: "all" | string[]; names: "all" | string[] }

export function accessOfMember(m: { scopes: unknown; role: { perms: readonly string[] } } & Partial<Pick<MembershipLike, "allBranches" | "branches">>): BranchAccess {
  if (m.role.perms.includes("*")) return { allowed: "all", names: "all" };
  if (m.allBranches === undefined) {
    // An object that has only the old column (callers that were not moved): the names are all there is.
    const s = m.scopes;
    const names = Array.isArray(s) ? s.filter((x): x is string => typeof x === "string") : "all";
    return { allowed: names === "all" ? "all" : [], names };
  }
  if (m.allBranches && m.branches?.length) {
    // Flag "all" but link rows present (inconsistent; only an owner sent a list can have it): the links win, narrower is safer.
    return { allowed: m.branches.map((l) => l.branchId), names: m.branches.map((l) => l.branch?.name).filter((n): n is string => typeof n === "string") };
  }
  if (m.allBranches) {
    // Written only the old way (a list of names, flag left at its default): never "every branch". Callers that have the business's
    // branches use reconcileOldNames() first; without them this fails closed (no ids, the names for display).
    if (Array.isArray(m.scopes)) return { allowed: [], names: m.scopes.filter((x): x is string => typeof x === "string") };
    return { allowed: "all", names: "all" };
  }
  const links = m.branches ?? [];
  return { allowed: links.map((l) => l.branchId), names: links.map((l) => l.branch?.name).filter((n): n is string => typeof n === "string") };
}

export interface BranchScopeInput {
  /** Every branch of the business, in the order the screens show them (sort, then creation). */
  all: readonly BranchInfo[];
  allowed: "all" | readonly string[];
  /** The x-branch header: a branch id, "all", or nothing. A branch the person may not use is refused. */
  wanted?: string | undefined;
}

export function createBranchScope(o: BranchScopeInput): BranchScope {
  const mine = o.allowed === "all" ? [...o.all] : o.all.filter((b) => (o.allowed as readonly string[]).includes(b.id));
  const mineIds = mine.map((b) => b.id);
  let picked: string | null = null;
  if (o.wanted && o.wanted !== "all") {
    if (!mineIds.includes(o.wanted)) throw forbidden("You don't work at that branch.");
    picked = o.wanted;
  }
  return {
    allowed: o.allowed, mine, picked,
    idsFor(scope) {
      if (scope === "all") return null;
      if (picked) return [picked];
      return o.allowed === "all" ? null : mineIds;   // limited people see all of theirs, even with "All branches" picked; none = []
    },
    branchForNew(asked) {
      if (asked) {
        const b = mine.find((x) => x.id === asked);
        if (!b) throw forbidden("You don't work at that branch.");
        if (b.status !== "open") throw badRequest("That branch is closed.");
        return b.id;
      }
      if (picked) return picked;
      const open = mine.filter((b) => b.status === "open");
      if (!open.length) throw forbidden("You aren't given any open branch. Ask the owner to give you one on the Team page.");
      if (open.length > 1) throw badRequest("Pick a branch first: at the top of the page, or in the form.");
      return open[0]!.id;
    },
    canSee: (id) => !id || mineIds.includes(id),   // a branch of another business is never in `mine`
  };
}

/** The business's branches in screen order (one query). */
export async function loadBranches(db: Db | Tx, tenantId: string): Promise<BranchInfo[]> {
  const rows = await db.branch.findMany({ where: { tenantId }, select: { id: true, name: true, status: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  return rows.map((b) => ({ id: b.id, name: b.name, status: b.status === "closed" ? "closed" : "open" }));
}

// ───────────── Entitlements ─────────────

interface AppInfo { id: string; kind: string; name: { en: string }; businessTypes: "all" | readonly string[] }
const APP_LIST = APPS as unknown as readonly AppInfo[];
const appName = (appId: string) => APP_LIST.find((a) => a.id === appId)?.name.en ?? appId;

export interface EntitlementInput {
  type: string;
  plan: Pick<PlanLike, "features">;
  /** The plan limits raised by bought add-ons (effectiveLimits). */
  limits: unknown;
  seatsUsed: number;
}

export function buildEntitlements(o: EntitlementInput): Entitlements {
  const limits = (o.limits ?? {}) as Record<string, number | undefined>;
  const features = (o.plan.features ?? {}) as Record<string, boolean | undefined>;
  const allKinds = !!features.all_kinds;
  const seatLimit = limits.seats ?? 1;
  // Phase 1 keeps today's answer: every app offered to the business type (or to all types on a plan with all_kinds).
  const hasApp = (appId: string): boolean => {
    const app = APP_LIST.find((a) => a.id === appId);
    if (!app || app.id === "platform") return false;
    return app.kind === "core" || app.businessTypes === "all" || allKinds || app.businessTypes.includes(o.type);
  };
  return {
    hasApp,
    edition: (appId) => (hasApp(appId) ? "default" : null),
    limit: (_appId, key) => { const v = limits[key]; return v === undefined || v === -1 ? null : v; },
    feature: (key) => !!features[key],
    seats: () => ({ used: o.seatsUsed, limit: seatLimit === -1 ? null : seatLimit }),
    ai: () => "locked",
  };
}

/** Seats in use: active members plus pending invitations that have not expired (ACCESS.md section 10). */
export async function countSeats(db: Db | Tx, tenantId: string, now: Date): Promise<number> {
  const [active, pending] = await Promise.all([
    db.membership.count({ where: { tenantId, status: "active" } }),
    db.invite.count({ where: { tenantId, status: "pending", expiresAt: { gt: now } } }),
  ]);
  return active + pending;
}

/** Does the person's role grant at least one permission of this app? ("workspace" counts for everyone who is a member.) */
export function canUseApp(ctx: Pick<BusinessContext, "entitlements" | "permissions">, appId: string): boolean {
  if (!ctx.entitlements.hasApp(appId)) return false;
  if (appId === "workspace") return true;
  return PERMISSION_CATALOG.some((p) => p.app === appId && ctx.permissions.can(p.id));
}

/** The two refusals of ACCESS.md section 7. 403 app_not_available = the business doesn't have the app; 403 forbidden = its role can't use it. */
export function requireAppAccess(ctx: Pick<BusinessContext, "entitlements" | "permissions">, appId: string): void {
  const name = appName(appId);
  if (!ctx.entitlements.hasApp(appId)) throw new AppError(403, "app_not_available", `Your business doesn't have ${name}.`, undefined, { appId, marketplace: true });
  if (!canUseApp(ctx, appId)) throw forbidden(`Your role can't use ${name}.`);
}

// ───────────── The contexts ─────────────

type Parts = Omit<BusinessContext, "tx" | "transaction">;

/** Adds `tx` and a real `transaction()`: it hands the same context back with tx set (KERNEL.md section 5). */
function assemble(parts: Parts, tx: Tx | null): BusinessContext {
  return {
    ...parts, tx,
    transaction: (async (fn: (c: BusinessContext) => Promise<unknown>) =>
      tx ? fn(assemble(parts, tx)) : parts.db.$transaction(async (t) => fn(assemble(parts, t)))) as BusinessContext["transaction"],
  };
}

const base = (r: RequestInfo) => ({ requestId: r.requestId, ip: r.ip, now: r.now ?? new Date(), db: r.db, log: r.log });

async function businessParts(
  r: RequestInfo, deps: TenancyDeps,
  t: { id: string; name: string; type: string; status: string; planId: string; plan: PlanLike },
  access: BranchAccess,
): Promise<{ branches: BranchScope; entitlements: Entitlements }> {
  const now = r.now ?? new Date();
  const [all, plan, seatsUsed] = await Promise.all([
    loadBranches(r.db, t.id),
    deps.effectiveLimits(r.db, t.id, t.plan),
    countSeats(r.db, t.id, now),
  ]);
  return {
    branches: createBranchScope({ all, allowed: access.allowed, wanted: header(r.headers, "x-branch") }),
    entitlements: buildEntitlements({ type: t.type, plan: t.plan, limits: plan.limits, seatsUsed }),
  };
}

/** The context of a business request: the person must be an active member of the business named in "x-tenant-id" (or their first one). */
export async function buildBusinessContext(r: RequestInfo & { user: SessionUserLike; approval?: { id: string; checkerId: string } }, deps: TenancyDeps): Promise<BusinessContext> {
  const wanted = header(r.headers, "x-tenant-id");
  const m = wanted ? r.user.memberships.find((x) => x.tenantId === wanted) : r.user.memberships[0];
  if (!m || m.status !== "active") throw forbidden("You are not a member of this business.");
  const t = m.tenant;
  const { branches, entitlements } = await businessParts(r, deps, t, accessOfMember(m));
  return assemble({
    ...base(r),
    actor: { kind: "user", userId: r.user.id, name: r.user.userName },
    business: { id: t.id, name: t.name, type: t.type, status: t.status, planId: t.planId },
    member: { userId: r.user.id, membershipId: m.id, roleId: m.role.id, roleKey: m.role.key, isOwner: m.role.perms.includes("*") },
    branches, permissions: buildPermissionSet(m.role.perms), entitlements, impersonation: null,
    // Set only while an approved request runs again as its maker (ACCESS.md 9.4 step 5); kept in the parts so a transaction opened from it still has it.
    ...(r.approval ? { approval: r.approval } : {}),
  }, null);
}

/** The context of the admin API: only people with a platform role, with the permissions of that role (old names work through the alias layer). */
export function buildStaffContext(r: RequestInfo & { user: Pick<SessionUserLike, "id" | "userName" | "platformRole"> }): StaffContext {
  const role = r.user.platformRole;
  // Object.hasOwn: a role string like "constructor" or "__proto__" must never match something inherited from Object.prototype.
  const perms = role && Object.hasOwn(LEGACY_PLATFORM_ROLES, role) ? LEGACY_PLATFORM_ROLES[role] : undefined;
  if (!role || !perms) throw forbidden("This is for Sheetal staff only.");
  return {
    ...base(r),
    actor: { kind: "staff", staffId: r.user.id, name: r.user.userName, role },
    tx: null,
    transaction: (async (fn: (c: StaffContext) => Promise<unknown>) => r.db.$transaction(async (t) => fn({ ...buildStaffContext(r), tx: t }))) as StaffContext["transaction"],
    staff: { id: r.user.id, role },
    permissions: buildPermissionSet(perms),
  };
}

export interface ImpersonationInput {
  staff: StaffContext;
  tenantId: string;
  /** 10 to 300 characters (a ticket number is welcome). */
  reason: string;
  /** Default 15, at most 30. */
  minutes?: number;
  /** Write mode needs platform.business.impersonate_write and is never allowed on a suspended business. Default false = read-only. */
  write?: boolean;
}

/**
 * "Log in as the business" for Sheetal support (ACCESS.md section 12), as far as it can be built before the session table (P1-DB-3):
 * the context has actor = the staff member, impersonation = { staffId, reason, expiresAt, readOnly }, and the owner role's permissions minus the
 * fixed deny list. BaseService refuses every write while `impersonation.readOnly` is true. It does not start or record a session.
 */
export async function buildImpersonationContext(r: RequestInfo & ImpersonationInput, deps: TenancyDeps): Promise<BusinessContext> {
  r.staff.permissions.require("platform.business.impersonate", "Your staff role can't open a business as support.");
  const reason = r.reason.trim();
  if (reason.length < 10 || reason.length > 300) throw badRequest("Give a reason of 10 to 300 characters.");
  const write = r.write === true;
  if (write) r.staff.permissions.require("platform.business.impersonate_write", "Only the super admin can open a business in write mode.");
  const t = await r.db.tenant.findUnique({ where: { id: r.tenantId }, include: { plan: true } });
  if (!t) throw notFound("Business not found.");
  if (write && t.status === "suspended") throw forbidden("A suspended business can only be opened read-only.");
  const now = r.now ?? new Date();
  const minutes = Math.min(Math.max(Math.trunc(r.minutes ?? 15), 1), 30);
  const { branches, entitlements } = await businessParts(r, deps, t, { allowed: "all", names: "all" });
  const actor = r.staff.actor;
  if (actor.kind !== "staff") throw forbidden("This is for Sheetal staff only.");
  return assemble({
    ...base(r),
    actor,
    business: { id: t.id, name: t.name, type: t.type, status: t.status, planId: t.planId },
    member: { userId: actor.staffId, membershipId: "", roleId: "", roleKey: "support", isOwner: false },
    branches, permissions: buildImpersonationPermissions(), entitlements,
    impersonation: { staffId: actor.staffId, reason, expiresAt: new Date(now.getTime() + minutes * 60_000), readOnly: !write },
  }, null);
}

export interface SupportSessionInput {
  /** The staff member who opened the session. */
  staff: { id: string; name: string; role: string };
  tenantId: string;
  /** The ImpersonationSession row: its id, reason, end time and mode are what the context carries. */
  session: { id: string; reason: string; expiresAt: Date; readOnly: boolean };
}

/**
 * The context of a request made inside an OPEN support session (ACCESS.md section 12): the same as buildImpersonationContext(), but from the stored
 * session row instead of a fresh start, so the end time and the mode are the ones the staff member was given. Refuses an ended or expired session.
 */
export async function buildSupportContext(r: RequestInfo & SupportSessionInput, deps: TenancyDeps): Promise<BusinessContext> {
  const now = r.now ?? new Date();
  if (r.session.expiresAt <= now) throw new AppError(401, "support_session_ended", "This support session has ended.");
  const t = await r.db.tenant.findUnique({ where: { id: r.tenantId }, include: { plan: true } });
  if (!t) throw notFound("Business not found.");
  const { branches, entitlements } = await businessParts(r, deps, t, { allowed: "all", names: "all" });
  return assemble({
    ...base(r),
    actor: { kind: "staff", staffId: r.staff.id, name: r.staff.name, role: r.staff.role },
    business: { id: t.id, name: t.name, type: t.type, status: t.status, planId: t.planId },
    member: { userId: r.staff.id, membershipId: "", roleId: "", roleKey: "support", isOwner: false },
    branches, permissions: buildImpersonationPermissions(), entitlements,
    impersonation: { staffId: r.staff.id, reason: r.session.reason, expiresAt: r.session.expiresAt, readOnly: r.session.readOnly, sessionId: r.session.id },
  }, null);
}
