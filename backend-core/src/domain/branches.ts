import type { Db } from "../lib/db.js";

// Branches of a business, for work that arrives from outside the panel (website enquiries, chat channels, calendar
// feeds): it goes to the listing's or room's branch when there is one, else to the business's head office.

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
