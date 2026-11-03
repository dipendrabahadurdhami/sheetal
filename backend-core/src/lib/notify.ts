import type { Db } from "./db.js";
import { worksAt } from "../domain/branches.js";

// In-app notifications (the bell on the website and in the panels). Emails are sent separately where needed.

export interface Note { type: string; title: string; message?: string; link?: string }

export async function notify(db: Db, userIds: (string | null | undefined)[], note: Note) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.notification.createMany({ data: ids.map((userId) => ({ userId, type: note.type, title: note.title.slice(0, 200), message: (note.message ?? "").slice(0, 1000), link: note.link })) });
}

/** Everyone in a business whose role can see leads (owners always). */
export async function leadPeople(db: Db, tenantId: string, branchId?: string | null) {
  const [members, branch] = await Promise.all([
    db.membership.findMany({ where: { tenantId, status: "active" }, select: { userId: true, scopes: true, role: { select: { perms: true } } } }),
    branchId ? db.branch.findUnique({ where: { id: branchId }, select: { name: true } }) : null,
  ]);
  // People who handle leads, at that branch (when one is given).
  return members.filter((m) => (m.role.perms.includes("*") || m.role.perms.includes("leads.view") || m.role.perms.includes("messages.reply")) && worksAt(m.scopes, m.role.perms, branch?.name)).map((m) => m.userId);
}
