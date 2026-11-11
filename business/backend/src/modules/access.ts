// Who is asking, in which business, with which role, and on which branches. Used by every business route.
// Where it fits: workspaceOf(request) at the start of each route; branchView(), inView() and branchFor() whenever a
// query touches branch work (listings, leads, rooms, bookings, tills). New code uses businessContextOf(request) instead.
// How it works: since P1-BE-3 this file is an ADAPTER over the tenancy context (platform/src/tenancy/context.ts). The panel sends the open
// business in "x-tenant-id" and the picked branch in "x-branch". The person must be an active member of that business; their role gives
// ws.can(...); their branch access (Team page) comes from the branch LINKS by branch id, and limits what they see. Every export keeps the
// shape it had: `ws.branches` is still a list of branch NAMES (computed from the linked ids), `ws.inBranch(name)` still takes a name.
// Rules: never query business data without the tenant id, and never branch data without inView(); owners and "all
// branches" people see everything, everyone else only their branches, even with "All branches" picked.

import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { requireUser, type SessionUser } from "@sheetal/backend-core/modules/auth/sessions";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { badRequest, forbidden } from "@sheetal/backend-core/lib/errors";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { accessOfMember, buildBusinessContext, buildSupportContext, createBranchScope, loadBranches, type TenancyDeps } from "@sheetal/platform/tenancy/context";

export type Member = SessionUser["memberships"][number];
export interface Workspace {
  user: SessionUser; member: Member; tenantId: string; can: (perm: string) => boolean;
  /** The branches this person works in: "all", or a list of branch NAMES (computed from the linked branch ids; set on the Team page). */
  branches: "all" | string[];
  /** The same as branch IDS (added in P1-BE-3): "all", or the ids of the branches this person is linked to. */
  branchIds: "all" | string[];
  /** Whether a record of this branch is theirs (records with no branch belong to everyone). */
  inBranch: (branch: string | null | undefined) => boolean;
}

export function workspaceOf(request: FastifyRequest): Workspace {
  const user = requireUser(request);
  const wanted = request.headers["x-tenant-id"];
  const member = typeof wanted === "string" && wanted
    ? user.memberships.find((m) => m.tenantId === wanted)
    : user.memberships[0];
  if (!member || member.status !== "active") throw forbidden("You are not a member of this business.");
  const access = accessOfMember(member);
  const branches = access.names;
  return {
    user, member, tenantId: member.tenantId, can: (perm) => hasPerm(member.role.perms, perm),
    branches, branchIds: access.allowed, inBranch: (b) => branches === "all" || !b || branches.includes(b),
  };
}

/** Owners always see every branch; everyone else sees what their membership allows (branch names, from the branch links). */
export function branchesOf(member: Pick<Member, "scopes" | "role"> & Partial<Pick<Member, "allBranches" | "branches">>): "all" | string[] {
  return accessOfMember(member).names;
}

/** The same as branchesOf(), as branch IDS: "all", or the ids of the branches the membership is linked to. */
export function branchIdsOf(member: Pick<Member, "scopes" | "role"> & Partial<Pick<Member, "allBranches" | "branches">>): "all" | string[] {
  return accessOfMember(member).allowed;
}

/** The new context for this request (KERNEL.md section 5): for controllers built on the kernel. Old routes keep using workspaceOf(). */
const deps: TenancyDeps = { effectiveLimits: (db, tenantId, plan) => effectiveLimits(db, tenantId, plan) };
export function businessContextOf(request: FastifyRequest): Promise<BusinessContext> {
  const info = { db: dbOf(request.server), headers: request.headers, ip: request.ip, requestId: String(request.id), log: request.log };
  const s = request.support;
  if (s) {
    // A Sheetal support session (ACCESS.md 12): the business of the session only, the owner's permissions minus the deny list, read-only unless write mode.
    const wanted = request.headers["x-tenant-id"];
    if (typeof wanted === "string" && wanted && wanted !== s.tenantId) throw forbidden("You are not a member of this business.");
    return buildSupportContext({
      ...info, tenantId: s.tenantId, staff: { id: s.staffId, name: s.staff.userName, role: s.staff.platformRole },
      session: { id: s.id, reason: s.reason, expiresAt: s.expiresAt, readOnly: s.readOnly },
    }, deps);
  }
  return buildBusinessContext({ ...info, user: requireUser(request) }, deps);
}

// ───── Which branches a request looks at ─────
// The panel sends the branch picked in the top bar in "x-branch" (a branch id, or "all"). People limited to some
// branches can only pick theirs; with "all" (or nothing sent) they see all of theirs, and owners and "all branches"
// people see the whole business. New work goes to the picked branch, or one chosen in the form.

export interface BranchView {
  /** The business's branches this person may use. */
  mine: { id: string; name: string; status: string }[];
  /** null = the whole business (no filter); otherwise the branch ids in view. */
  ids: string[] | null;
  /** The one branch picked (or the person's only branch), for new work. */
  pick: string | null;
}

const views = new WeakMap<FastifyRequest, Promise<BranchView>>();

export function branchView(db: PrismaClient, request: FastifyRequest, ws: Workspace): Promise<BranchView> {
  let v = views.get(request);
  if (!v) { v = loadView(db, request, ws); views.set(request, v); }
  return v;
}

async function loadView(db: PrismaClient, request: FastifyRequest, ws: Workspace): Promise<BranchView> {
  const wanted = request.headers["x-branch"];
  const scope = createBranchScope({ all: await loadBranches(db, ws.tenantId), allowed: ws.branchIds, wanted: typeof wanted === "string" ? wanted : undefined });
  const open = scope.mine.filter((b) => b.status === "open");
  return { mine: scope.mine.map((b) => ({ ...b })), ids: scope.idsFor("branch") as string[] | null, pick: scope.picked ?? (open.length === 1 ? open[0]!.id : null) };
}

/** Prisma filter for records that carry a branch (listings, leads, rooms, bookings, shifts, bills). */
export const inView = (v: BranchView) => (v.ids ? { branchId: { in: v.ids } } : {});

/** The branch for new work: the one asked for (it must be the person's, and open), else the picked one, else the
 *  person's only open branch. With several branches and "All branches" picked, they must choose one. */
export function branchFor(v: BranchView, asked?: string | null): string {
  if (asked) {
    const b = v.mine.find((x) => x.id === asked);
    if (!b) throw forbidden("You don't work at that branch.");
    if (b.status !== "open") throw badRequest("That branch is closed.");
    return b.id;
  }
  if (v.pick) return v.pick;
  const open = v.mine.filter((b) => b.status === "open");
  if (!open.length) throw forbidden("You aren't given any open branch. Ask the owner to give you one on the Team page.");
  if (open.length > 1) throw badRequest("Pick a branch first: at the top of the page, or in the form.");
  return open[0]!.id;
}
