import type { Db } from "./db.js";

// In-app notifications (the bell on the website and in the panels). Emails are sent separately where needed.

export interface Note { type: string; title: string; message?: string; link?: string }

export async function notify(db: Db, userIds: (string | null | undefined)[], note: Note) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.notification.createMany({ data: ids.map((userId) => ({ userId, type: note.type, title: note.title.slice(0, 200), message: (note.message ?? "").slice(0, 1000), link: note.link })) });
}

/** Everyone in a business whose role can see leads (owners always). */
export async function leadPeople(db: Db, tenantId: string) {
  const members = await db.membership.findMany({ where: { tenantId, status: "active" }, select: { userId: true, role: { select: { perms: true } } } });
  return members.filter((m) => m.role.perms.includes("*") || m.role.perms.includes("leads.view") || m.role.perms.includes("messages.reply")).map((m) => m.userId);
}
