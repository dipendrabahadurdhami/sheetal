import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { requireUser, type SessionUser } from "@sheetal/backend-core/modules/auth/sessions";
import { badRequest, forbidden } from "@sheetal/backend-core/lib/errors";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";

// Which business a request is for, and what the person may do in it.
// The business panel sends the workspace it has open in the "x-tenant-id" header; without it, the person's
// first business is used. A person can only act in a business they are a member of.

export type Member = SessionUser["memberships"][number];
export interface Workspace {
  user: SessionUser; member: Member; tenantId: string; can: (perm: string) => boolean;
  /** The branches this person works in: "all", or a list of branch names (set on the Team page). */
  branches: "all" | string[];
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
  const branches = branchesOf(member);
  return {
    user, member, tenantId: member.tenantId, can: (perm) => hasPerm(member.role.perms, perm),
    branches, inBranch: (b) => branches === "all" || !b || branches.includes(b),
  };
}

/** Owners always see every branch; everyone else sees what their membership allows. */
export function branchesOf(member: Pick<Member, "scopes" | "role">): "all" | string[] {
  if (member.role.perms.includes("*")) return "all";
  const s = member.scopes;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === "string") : "all";
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
  const all = await db.branch.findMany({ where: { tenantId: ws.tenantId }, select: { id: true, name: true, status: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  const mine = all.filter((b) => ws.inBranch(b.name));
  const wanted = request.headers["x-branch"];
  if (typeof wanted === "string" && wanted && wanted !== "all") {
    if (!mine.some((b) => b.id === wanted)) throw forbidden("You don't work at that branch.");
    return { mine, ids: [wanted], pick: wanted };
  }
  const open = mine.filter((b) => b.status === "open");
  return { mine, ids: ws.branches === "all" ? null : mine.map((b) => b.id), pick: open.length === 1 ? open[0]!.id : null };
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
