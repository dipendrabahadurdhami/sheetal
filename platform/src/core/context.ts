// The request context: who is asking, for which business and branches, with which permissions and plan.
// Where it fits: built once per request by the controller (P1-BE-3 writes the builder); read by services and repositories.
// How it works: types, plus two tiny helpers at the bottom. A context is a plain object; ctx.transaction() hands the same context back with `tx` set,
// so everything inside one write joins one database transaction (KERNEL.md sections 5 and 6).
// Rules: a repository takes the business from the context and never from the caller; the types below are exactly the ones
// in KERNEL.md section 5, with two small additions marked "added" (BusinessType as a plain string, SystemContext).

import type { Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client.js";

export type Tx = Prisma.TransactionClient;

/** The kind of business ("hotel", "agency"…). Added: a plain string until the manifests (P1-BE-2) list the real ones. */
export type BusinessType = string;

export type Actor =
  | { kind: "user"; userId: string; name: string }
  | { kind: "staff"; staffId: string; name: string; role: string }   // Sheetal staff (admin panel, or impersonating)
  | { kind: "system"; job: string };                                   // background jobs, event handlers

export interface BaseContext {
  readonly requestId: string;            // request.id, returned in every error
  readonly ip: string;
  readonly now: Date;                    // fixed for the whole request; tests can set it. Stored in UTC.
  readonly actor: Actor;
  readonly db: Db;                       // the PrismaClient (platform/src/db/client.ts)
  readonly tx: Tx | null;                // set only inside ctx.transaction()
  readonly log: FastifyBaseLogger;
  transaction<R>(fn: (ctx: this) => Promise<R>): Promise<R>;   // returns a copy of the context with tx set
}

export interface BusinessContext extends BaseContext {
  readonly business: { id: string; name: string; type: BusinessType; status: string; planId: string };
  readonly member: { userId: string; membershipId: string; roleId: string; roleKey: string; isOwner: boolean };
  readonly branches: BranchScope;
  readonly permissions: PermissionSet;
  readonly entitlements: Entitlements;
  readonly impersonation: { staffId: string; reason: string; expiresAt: Date; readOnly: boolean; sessionId?: string } | null;
  /** Set only while an approved request runs again (ACCESS.md 9.4 step 5): the action is not held a second time, and its audit row carries both ids. */
  readonly approval?: { id: string; checkerId: string };
}

export interface StaffContext extends BaseContext {
  readonly staff: { id: string; role: string };
  readonly permissions: PermissionSet;   // platform permissions, see ACCESS.md sections 6.2 and 11
}

/** Added: what an event handler runs with: a BusinessContext of the event's business whose actor is the handler itself. */
export type SystemContext = BusinessContext & { readonly actor: { kind: "system"; job: string } };

// ── Branch scope (replaces branchesOf, branchView, inView, branchFor, worksAt; all by branch ID) ──

export interface BranchInfo { id: string; name: string; status: "open" | "closed" }

export interface BranchScope {
  /** What the person's membership allows: every branch of the business, or a list of branch ids. Owners are always "all". */
  readonly allowed: "all" | readonly string[];
  /** The branches this person may use (loaded once per request). */
  readonly mine: readonly BranchInfo[];
  /** What the top bar picked (x-branch). null = "All branches". */
  readonly picked: string | null;
  /** Branch ids to filter by for a data scope. null = no branch filter (the whole business). An empty list means "none". */
  idsFor(scope: DataScope): readonly string[] | null;
  /** The branch for new work: asked, then picked, then the person's only open branch; throws like branchFor() does today. */
  branchForNew(asked?: string | null): string;
  /** Whether a record of this branch is visible to this person (records with no branch belong to everyone).
   *  A branch id that is not one of this business's branches must give false. */
  canSee(branchId: string | null | undefined): boolean;
}

// ── Permissions ──

export type DataScope = "own" | "branch" | "all";     // narrowest to widest
export type PermissionId = string;                    // "app.resource.action", e.g. "expenses.expense.create"

export interface PermissionSet {
  can(perm: PermissionId): boolean;                   // true for "*" holders
  scopeOf(perm: PermissionId): DataScope | null;      // null = not granted. "*" gives "all".
  require(perm: PermissionId, message?: string): DataScope;   // throws forbidden(message) if not granted; returns the scope
  canAny(perms: readonly PermissionId[]): boolean;
}

// ── Entitlements (what the business has bought or been given) ──

export interface Entitlements {
  hasApp(appId: string): boolean;                     // is the app installed and paid/free-tier for this business?
  edition(appId: string): string | null;              // "free" | "pro" | … (Phase 3); Phase 1: "default"
  limit(appId: string, key: string): number | null;   // null = unlimited; -1 from old plans is mapped to null
  feature(key: string): boolean;                      // e.g. "custom_roles", "branding.custom", "all_kinds"
  seats(): { used: number; limit: number | null };
  ai(appId: string): "locked" | "own_key" | "sheetal";
}

const RANK: Record<DataScope, number> = { own: 0, branch: 1, all: 2 };
/** The narrower of two scopes (an action may ask for less than a person was granted, never more). */
export const narrowest = (a: DataScope, b: DataScope): DataScope => (RANK[a] <= RANK[b] ? a : b);

/** The user id to write in createdBy / updatedBy / AuditLog.actorId: the person, or the staff member acting; null for jobs. */
export const actorIdOf = (ctx: Pick<BaseContext, "actor">): string | null =>
  ctx.actor.kind === "user" ? ctx.actor.userId : ctx.actor.kind === "staff" ? ctx.actor.staffId : null;
