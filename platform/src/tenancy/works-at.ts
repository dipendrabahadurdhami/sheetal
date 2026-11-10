// Whether someone works at a branch: the one rule notifications, forms, leads and the Team page share.
// Where it fits: moved here from backend-core/src/domain/branches.ts (P1-BE-4) so platform/src/notify can use it without importing
// backend-core; that file re-exports worksAt and MemberBranches, so no caller changes.
// How it works: answers from the branch LINKS (Membership.allBranches + MembershipBranch, by branch id), since P1-BE-3. The old call
// with branch NAMES still works until `scopes` is frozen.
// Rules: owners and records with no branch are open to everyone. A row written only the old way (a list of names, the flag left at
// "all") is never "every branch" (fail closed, P1-BE-3): it works at a branch only when the caller gives the branch name and the list has it.
// The body is the one that was in branches.ts, unchanged.

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
