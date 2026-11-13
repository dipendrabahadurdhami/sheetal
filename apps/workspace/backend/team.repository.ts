// The only code in the Workspace app that reads and writes a business's team: members, pending invitations, roles, the business row itself (profile,
// branding, cover) and the team's activity list (KERNEL.md section 6). Moved out of business/backend/src/modules/team/routes.ts in P2-W6 (Workspace part 2).
// Where it fits: TeamService calls these, in its transaction for a change. The access system (platform/src/tenancy) also reads memberships and roles to
// build every request's context; that reading stays where it is.
// How it works: plain Prisma calls on the context's transaction (or the client when reading). Branch access rows are written with the platform helpers
// (setLinks, accessColumns) so the new rows and the old names never disagree (ACCESS.md 3.4).
// Rules: every query carries this business (an invitation is found by its token only on the public preview and accept pages, which have no business yet).

import type { Prisma } from "@prisma/client";
import type { BusinessContext } from "@sheetal/platform/core/context";

type Tx = Prisma.TransactionClient;
export const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
/** The link rows of a member or invite, in screen order, with the branch name (for the old `scopes` answer). */
export const linksInclude = { select: { branchId: true, branch: { select: { name: true } } }, orderBy: [{ branch: { sort: "asc" as const } }, { branch: { createdAt: "asc" as const } }] };

export class TeamRepository {
  // ───── The business row ─────
  tenant(ctx: BusinessContext) { return db(ctx).tenant.findUniqueOrThrow({ where: { id: ctx.business.id }, include: { plan: true } }); }
  saveTenant(ctx: BusinessContext, data: Prisma.TenantUncheckedUpdateInput) { return db(ctx).tenant.update({ where: { id: ctx.business.id }, data }); }
  coveredByThis(ctx: BusinessContext) { return db(ctx).tenant.count({ where: { coveredById: ctx.business.id } }); }
  voidOpenInvoices(ctx: BusinessContext) { return db(ctx).invoice.updateMany({ where: { tenantId: ctx.business.id, status: "open" }, data: { status: "void" } }); }

  // ───── Team page ─────
  members(ctx: BusinessContext) {
    return db(ctx).membership.findMany({ where: { tenantId: ctx.business.id, status: { in: ["active", "paused"] } }, include: { user: true, branches: linksInclude }, orderBy: { createdAt: "asc" } });
  }
  pendingInvites(ctx: BusinessContext) {
    return db(ctx).invite.findMany({ where: { tenantId: ctx.business.id, status: "pending" }, include: { branches: linksInclude }, orderBy: { createdAt: "desc" } });
  }
  roles(ctx: BusinessContext) { return db(ctx).role.findMany({ where: { tenantId: ctx.business.id }, orderBy: [{ system: "desc" }, { key: "asc" }] }); }
  activity(ctx: BusinessContext) { return db(ctx).auditLog.findMany({ where: { tenantId: ctx.business.id }, orderBy: { createdAt: "desc" }, take: 50 }); }
  /** Active members plus pending, unexpired invitations (paused members don't take a seat). */
  async seatsTaken(ctx: BusinessContext) {
    const [pending, active] = await Promise.all([
      db(ctx).invite.count({ where: { tenantId: ctx.business.id, status: "pending", expiresAt: { gt: new Date() } } }),
      db(ctx).membership.count({ where: { tenantId: ctx.business.id, status: "active" } }),
    ]);
    return active + pending;
  }
  branchNames(ctx: BusinessContext) { return db(ctx).branch.findMany({ where: { tenantId: ctx.business.id }, select: { id: true, name: true } }); }

  // ───── Roles ─────
  role(ctx: BusinessContext, id: string) { return db(ctx).role.findFirst({ where: { id, tenantId: ctx.business.id } }); }
  roleWithCount(ctx: BusinessContext, id: string) { return db(ctx).role.findFirst({ where: { id, tenantId: ctx.business.id }, include: { _count: { select: { memberships: true } } } }); }
  createRole(ctx: BusinessContext, d: { key: string; name: string; perms: string[] }) { return db(ctx).role.create({ data: { tenantId: ctx.business.id, ...d, system: false } }); }
  /** Only the role of this business, found by the caller first. */
  updateRole(ctx: BusinessContext, id: string, d: { name?: string; perms?: string[] }) { return db(ctx).role.update({ where: { id }, data: d }); }
  deleteRole(ctx: BusinessContext, id: string) { return db(ctx).role.delete({ where: { id } }); }

  // ───── Members ─────
  member(ctx: BusinessContext, userId: string) {
    return db(ctx).membership.findFirst({ where: { tenantId: ctx.business.id, userId }, include: { role: true, branches: linksInclude, user: { select: { userName: true, email: true } } } });
  }
  memberByEmail(ctx: BusinessContext, email: string) { return db(ctx).membership.findFirst({ where: { tenantId: ctx.business.id, user: { email } } }); }
  otherOwners(ctx: BusinessContext, userId: string) {
    return db(ctx).membership.count({ where: { tenantId: ctx.business.id, status: "active", role: { key: "owner" }, userId: { not: userId } } });
  }
  /** Only the membership of this business, found by the caller first. */
  updateMember(ctx: BusinessContext, id: string, data: Prisma.MembershipUncheckedUpdateInput) { return db(ctx).membership.update({ where: { id }, data }); }
  deleteMember(ctx: BusinessContext, id: string) { return db(ctx).membership.delete({ where: { id } }); }

  // ───── Invitations ─────
  revokePendingFor(ctx: BusinessContext, email: string) { return db(ctx).invite.updateMany({ where: { tenantId: ctx.business.id, email, status: "pending" }, data: { status: "revoked" } }); }
  createInvite(ctx: BusinessContext, data: Omit<Prisma.InviteUncheckedCreateInput, "tenantId">) { return db(ctx).invite.create({ data: { ...data, tenantId: ctx.business.id } }); }
  pendingInvite(ctx: BusinessContext, id: string) { return db(ctx).invite.findFirst({ where: { id, tenantId: ctx.business.id, status: "pending" } }); }
  renewInvite(ctx: BusinessContext, id: string, tokenHash: string, expiresAt: Date) { return db(ctx).invite.update({ where: { id }, data: { tokenHash, sentAt: new Date(), expiresAt } }); }
  async revokeInvite(ctx: BusinessContext, id: string) { return (await db(ctx).invite.updateMany({ where: { id, tenantId: ctx.business.id, status: "pending" }, data: { status: "revoked" } })).count > 0; }
  roleById(ctx: BusinessContext, id: string) { return db(ctx).role.findFirstOrThrow({ where: { id, tenantId: ctx.business.id } }); }
}

/** The routes that run before the person is in the business: the invitation pages find the invitation by its one-time token; a new business may be
 *  covered by the person's Pro business. */
export class InviteTokenRepository {
  coverNew(d: Tx, id: string, coveredById: string) { return d.tenant.update({ where: { id }, data: { coveredById } }); }
  byToken(d: Tx, tokenHash: string) { return d.invite.findUnique({ where: { tokenHash }, include: { tenant: { select: { name: true, type: true } } } }); }
  forAccept(d: Tx, tokenHash: string) { return d.invite.findUnique({ where: { tokenHash }, include: { tenant: true, branches: linksInclude } }); }
  roleName(d: Tx, id: string) { return d.role.findUnique({ where: { id }, select: { key: true, name: true } }); }
  branchNames(d: Tx, tenantId: string) { return d.branch.findMany({ where: { tenantId }, select: { id: true, name: true } }); }
  join(d: Tx, o: { userId: string; tenantId: string; roleId: string; scopes: Prisma.InputJsonValue; allBranches: boolean }) {
    const cols = { scopes: o.scopes, allBranches: o.allBranches };
    return d.membership.upsert({ where: { userId_tenantId: { userId: o.userId, tenantId: o.tenantId } }, create: { userId: o.userId, tenantId: o.tenantId, roleId: o.roleId, ...cols }, update: { roleId: o.roleId, ...cols, status: "active" } });
  }
  accepted(d: Tx, id: string) { return d.invite.update({ where: { id }, data: { status: "accepted" } }); }
  audit(d: Tx, row: { tenantId: string; actorId: string; action: string; target?: string; ip: string; meta?: Prisma.InputJsonValue }) { return d.auditLog.create({ data: row }); }
}
