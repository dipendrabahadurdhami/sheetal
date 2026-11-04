// In-app notifications (the bell on the website and in both panels).
// Where it fits: called wherever something needs someone's attention: new leads, payments, reviews, verification,
// work waiting for Sheetal staff.
// How it works: one row per person. A note about a business carries its id, so that business's bell shows it; notes
// without one are the person's own (website) or, with an /admin link, staff work (admin bell). teamWith() finds the
// people with a permission at a branch; notifyStaff() finds the staff roles that handle a task.

import type { Db } from "./db.js";
import { worksAt } from "../domain/branches.js";
import { PLATFORM_ROLES, hasPerm } from "../domain/permissions.js";

export interface Note { type: string; title: string; message?: string; link?: string; tenantId?: string | null }

export async function notify(db: Db, userIds: (string | null | undefined)[], note: Note) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.notification.createMany({ data: ids.map((userId) => ({ userId, tenantId: note.tenantId ?? null, type: note.type, title: note.title.slice(0, 200), message: (note.message ?? "").slice(0, 1000), link: note.link })) });
}

/** Sheetal staff whose platform role covers `perm` (super admins always). */
export async function notifyStaff(db: Db, perm: string, note: Omit<Note, "tenantId">) {
  const roles = Object.entries(PLATFORM_ROLES).filter(([, perms]) => hasPerm(perms, perm)).map(([r]) => r);
  const staff = await db.user.findMany({ where: { platformRole: { in: roles } }, select: { id: true } });
  await notify(db, staff.map((s) => s.id), { ...note, tenantId: null });
}

/** Everyone in a business whose role has one of `perms` (owners always), at that branch when one is given. */
export async function teamWith(db: Db, tenantId: string, perms: string[], branchId?: string | null) {
  const [members, branch] = await Promise.all([
    db.membership.findMany({ where: { tenantId, status: "active" }, select: { userId: true, scopes: true, role: { select: { perms: true } } } }),
    branchId ? db.branch.findUnique({ where: { id: branchId }, select: { name: true } }) : null,
  ]);
  return members.filter((m) => (m.role.perms.includes("*") || perms.some((p) => m.role.perms.includes(p))) && worksAt(m.scopes, m.role.perms, branch?.name)).map((m) => m.userId);
}

/** Everyone in a business whose role can see leads (owners always). */
export const leadPeople = (db: Db, tenantId: string, branchId?: string | null) => teamWith(db, tenantId, ["leads.view", "messages.reply"], branchId);
