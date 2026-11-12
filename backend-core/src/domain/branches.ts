// Branch helpers for work that arrives from outside the panels (website enquiries, chat messages, calendar feeds).
// Where it fits: used by the website API, the chat webhook and calendar sync to file new work under a branch, and by
// notifications to reach only the people who work at that branch.
// How it works: work goes to the listing's or room's branch when known, else to the business's head office (its
// first open branch). worksAt() answers from the branch LINKS (Membership.allBranches + MembershipBranch, by branch id) since P1-BE-3;
// the old call with branch NAMES still works until `scopes` is frozen. worksAt() itself now lives in platform/src/tenancy/works-at.ts
// and is re-exported from here.

import type { Db } from "@sheetal/platform/db/client";

/** The business's first open branch (its head office), or null for a business without one. */
export async function headOffice(db: Db, tenantId: string): Promise<string | null> {
  const b = await db.branch.findFirst({ where: { tenantId, status: "open" }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } })
    ?? await db.branch.findFirst({ where: { tenantId }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true } });
  return b?.id ?? null;
}

// worksAt() and MemberBranches moved to platform/src/tenancy/works-at.ts (P1-BE-4); same names, same behaviour.
export { worksAt, type MemberBranches } from "@sheetal/platform/tenancy/works-at";
