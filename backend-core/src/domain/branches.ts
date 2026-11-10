// Branch helpers for work that arrives from outside the panels (website enquiries, chat messages, calendar feeds).
// Where it fits: used by the website API, the chat webhook and calendar sync to file new work under a branch, and by
// notifications to reach only the people who work at that branch.
// How it works: work goes to the listing's or room's branch when known, else to the business's head office (its
// first open branch). worksAt() answers from the branch LINKS (Membership.allBranches + MembershipBranch, by branch id) since P1-BE-3;
// the old call with branch NAMES still works until `scopes` is frozen.

import type { Db } from "../lib/db.js";

/** The business's first open branch (its head office), or null for a business without one. */
export async function headOffice(db: Db, tenantId: string): Promise<string | null> {
  const b = await db.branch.findFirst({ where: { tenantId, status: "open" }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } })
    ?? await db.branch.findFirst({ where: { tenantId }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } });
  return b?.id ?? null;
}

/** What worksAt() needs of a membership: its role, and the new branch rows (select `allBranches` and `branches: { select: { branchId: true } }`). */
export interface MemberBranches { allBranches: boolean; branches: readonly { branchId: string }[]; role: { perms: string[] }; scopes?: unknown }

/** Whether someone works at the branch: owners and "all branches" people always do; records with no branch belong to everyone. By branch id. */
export function worksAt(member: MemberBranches, branchId: string | null | undefined, branchName?: string | null): boolean;
/** @deprecated The old call with branch NAMES; kept for callers that were not moved. Removed when `scopes` is frozen. */
export function worksAt(scopes: unknown, perms: string[], branchName: string | null | undefined): boolean;
export function worksAt(a: unknown, b: unknown, c?: unknown): boolean {
  if (Array.isArray(b)) {
    const perms = b as string[];
    if (perms.includes("*") || !c || !Array.isArray(a)) return true;
    return a.includes(c as string);
  }
  const member = a as MemberBranches;
  const branchId = b as string | null | undefined;
  if (member.role.perms.includes("*") || !branchId) return true;
  if (member.allBranches && member.branches.length) return member.branches.some((l) => l.branchId === branchId);   // inconsistent: links win
  if (member.allBranches) {
    // A row written only the old way (a list of names, flag left at "all") is never "every branch" (fail closed, P1-BE-3): it works at a
    // branch only when the caller gives the branch name and the list has it.
    if (!Array.isArray(member.scopes)) return true;
    const name = typeof c === "string" ? c.toLowerCase() : null;
    return !!name && member.scopes.some((x) => typeof x === "string" && x.toLowerCase() === name);
  }
  return member.branches.some((l) => l.branchId === branchId);
}
