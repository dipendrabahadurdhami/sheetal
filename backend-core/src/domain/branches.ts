// Branch helpers for work that arrives from outside the panels (website enquiries, chat messages, calendar feeds).
// Where it fits: used by the website API, the chat webhook and calendar sync to file new work under a branch, and by
// notifications to reach only the people who work at that branch.
// How it works: work goes to the listing's or room's branch when known, else to the business's head office (its
// first open branch).

import type { Db } from "../lib/db.js";

/** The business's first open branch (its head office), or null for a business without one. */
export async function headOffice(db: Db, tenantId: string): Promise<string | null> {
  const b = await db.branch.findFirst({ where: { tenantId, status: "open" }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } })
    ?? await db.branch.findFirst({ where: { tenantId }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } });
  return b?.id ?? null;
}

/** Whether someone with this branch access ("all" or a list of branch names; owners always all) works at the branch. */
export function worksAt(scopes: unknown, perms: string[], branchName: string | null | undefined) {
  if (perms.includes("*") || !branchName || !Array.isArray(scopes)) return true;
  return scopes.includes(branchName);
}
