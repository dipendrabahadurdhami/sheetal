// In-app notifications (the bell on the website and in both panels).
// Where it fits: moved here from backend-core/src/lib/notify.ts (P1-BE-4); that file re-exports everything, so the many callers do
// not change. Called wherever something needs someone's attention: new leads, payments, reviews, verification, work waiting for staff.
// How it works: one row per person. A note about a business carries its id, so that business's bell shows it; notes
// without one are the person's own (website) or, with an /admin link, staff work (admin bell). teamWith() finds the
// people with a permission at a branch (by branch id, from the branch links); notifyStaff() finds the staff roles that handle a task.
// Rules: the bodies of notify, notifyStaff, teamWith and leadPeople are the ones that were in backend-core; teamWith keeps the fail-closed
// reconcileOldNames() step of P1-BE-3 exactly as it was.

import type { Db } from "../db/client.js";
import { hasPerm } from "../tenancy/perms.js";
import { STAFF_GRANTS } from "../tenancy/staff-roles.js";
import { reconcileOldNames } from "../tenancy/branch-links.js";
import { worksAt } from "../tenancy/works-at.js";

export interface Note { type: string; title: string; message?: string; link?: string; tenantId?: string | null }

export async function notify(db: Db, userIds: (string | null | undefined)[], note: Note) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.notification.createMany({ data: ids.map((userId) => ({ userId, tenantId: note.tenantId ?? null, type: note.type, title: note.title.slice(0, 200), message: (note.message ?? "").slice(0, 1000), link: note.link })) });
}

/**
 * Which Sheetal staff a notice is for, by the staff permission that handles that work. Business and website code names the WORK here
 * (STAFF_FOR.listingReview) and never writes a staff permission itself: backend-core/test/permissions-worlds.test.ts keeps the two worlds apart.
 */
export const STAFF_FOR = {
  /** Listings and paid requirements waiting for a check. */
  listingReview: "platform.listing.moderate",
  /** Leads and messages meant for Sheetal itself. */
  leads: "platform.business.read",
  /** Requests about a business that staff act on (plan upgrades, channel requests). */
  businessRequests: "platform.business.read+platform.business.create+platform.business.update",
} as const;

/** Sheetal staff whose platform role covers `perm` (super admins always). */
export async function notifyStaff(db: Db, perm: string, note: Omit<Note, "tenantId">) {
  const roles = [...STAFF_GRANTS].filter(([, perms]) => hasPerm(perms, perm)).map(([r]) => r);
  const staff = await db.user.findMany({ where: { platformRole: { in: roles } }, select: { id: true } });
  await notify(db, staff.map((s) => s.id), { ...note, tenantId: null });
}

/** Everyone in a business whose role has one of `perms` (owners always), at that branch (by id) when one is given. */
export async function teamWith(db: Db, tenantId: string, perms: string[], branchId?: string | null) {
  const [rows, branches] = await Promise.all([
    db.membership.findMany({
      where: { tenantId, status: "active" },
      select: { userId: true, scopes: true, allBranches: true, branches: { select: { branchId: true } }, role: { select: { perms: true } } },
    }),
    db.branch.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  const members = rows.map((m) => reconcileOldNames(m, branches));   // a row written only the old way is never "every branch"
  return members.filter((m) => perms.some((p) => hasPerm(m.role.perms, p)) && worksAt(m, branchId)).map((m) => m.userId);
}

/** Everyone in a business whose role can see leads (owners always). */
export const leadPeople = (db: Db, tenantId: string, branchId?: string | null) => teamWith(db, tenantId, ["crm.lead.read", "crm.message.reply"], branchId);
