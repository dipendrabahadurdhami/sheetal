// Branch access by branch ID, written the old way and the new way together (ACCESS.md section 3.4, step 3: "dual write").
// Where it fits: the business API's team routes (invite, edit member, accept invite) and branch routes (rename, remove) call these helpers
// inside their own transaction, so the OLD column `scopes` (branch names) and the NEW rows (`allBranches` + MembershipBranch / InviteBranch)
// never disagree. Every read in the code uses the new rows; the old names are only written so a rollback to the old code still works.
// How it works: resolveBranchAccess() turns what a request body says ("branchIds" or the old "scopes") into one answer, checking that each
// branch is an OPEN branch of this business; accessColumns() gives the two columns to save; setLinks() replaces the rows;
// syncOldNames() rewrites the old names of the people linked to a branch after it was renamed or removed.
// Rules: an owner (role with "*") is always allBranches = true, whatever list was sent (the old code ignored the list for owners too); a limited
// person left with no rows has no branch (never "all"); messages are the ones the old checkScopes() gave. Remove the old-name writes when
// `scopes` is frozen (ACCESS.md section 3.4, step 5).

import type { Prisma } from "@prisma/client";
import { badRequest } from "../core/errors.js";
import type { Db } from "../db/client.js";

type Reader = Db | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

/** What a request body may say about branches: the new way, the old way, or nothing. */
export interface BranchAccessAsk { branchIds?: "all" | string[] | undefined; scopes?: "all" | string[] | undefined }

/** The checked answer: every branch (`all`), or these branches (ids, with the same branches as names in the same order). */
export interface ResolvedAccess { all: boolean; ids: string[]; names: string[] }

export const EVERY_BRANCH: ResolvedAccess = { all: true, ids: [], names: [] };

/**
 * Turns the request's branch access into ids. `branchIds` wins when both are sent. Returns undefined when the body says nothing about
 * branches (the caller then keeps what the person has, or uses "all" for a new invitation). Throws 400 with today's messages when an entry
 * is not an open branch of this business.
 */
export async function resolveBranchAccess(db: Reader, tenantId: string, ask: BranchAccessAsk): Promise<ResolvedAccess | undefined> {
  const list = ask.branchIds ?? ask.scopes;
  if (list === undefined) return undefined;
  if (list === "all") return EVERY_BRANCH;
  if (!list.length) throw badRequest("Pick at least one branch, or all branches.");
  const byId = ask.branchIds !== undefined;
  const open = await db.branch.findMany({
    where: { tenantId, status: "open", ...(byId ? { id: { in: list } } : { name: { in: list } }) },
    select: { id: true, name: true },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
  });
  const missing = list.filter((x) => !open.some((b) => (byId ? b.id : b.name) === x));
  if (missing.length) throw badRequest(`${missing.join(", ")} ${missing.length > 1 ? "aren't open branches" : "isn't an open branch"} of this business.`);
  const wanted = new Set(list);
  const chosen = open.filter((b) => wanted.has(byId ? b.id : b.name));
  return { all: false, ids: chosen.map((b) => b.id), names: chosen.map((b) => b.name) };
}

/**
 * Names -> ids the way the P1-DB-2 backfill does it: an exact match wins; otherwise a case-insensitive match counts only when exactly one
 * branch matches; anything else is stale and dropped. Used when a list of OLD names has to be turned into links (a demoted owner, the resync).
 */
export function accessFromNames(branches: readonly { id: string; name: string }[], names: unknown): ResolvedAccess {
  if (!Array.isArray(names)) return EVERY_BRANCH;
  const hits: { id: string; name: string }[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const exact = branches.find((b) => b.name === raw);
    const loose = branches.filter((b) => b.name.toLowerCase() === raw.toLowerCase());
    const hit = exact ?? (loose.length === 1 ? loose[0] : undefined);
    if (hit && !hits.some((h) => h.id === hit.id)) hits.push(hit);
  }
  return { all: false, ids: hits.map((h) => h.id), names: hits.map((h) => h.name) };
}

/** The two columns to save on a Membership or Invite. */
export function accessColumns(a: ResolvedAccess, ownerRole: boolean): { scopes: Prisma.InputJsonValue; allBranches: boolean } {
  return { scopes: a.all ? "all" : a.names, allBranches: a.all || ownerRole };
}

/** Replaces the link rows of one membership or invitation. An owner with a LIST keeps the rows it has (they are ignored while the role is owner). */
export async function setLinks(tx: Tx, kind: "membership" | "invite", rowId: string, a: ResolvedAccess, ownerRole: boolean): Promise<void> {
  if (ownerRole && !a.all) return;
  if (kind === "membership") {
    await tx.membershipBranch.deleteMany({ where: { membershipId: rowId } });
    if (!a.all && a.ids.length) await tx.membershipBranch.createMany({ data: a.ids.map((branchId) => ({ membershipId: rowId, branchId })) });
  } else {
    await tx.inviteBranch.deleteMany({ where: { inviteId: rowId } });
    if (!a.all && a.ids.length) await tx.inviteBranch.createMany({ data: a.ids.map((branchId) => ({ inviteId: rowId, branchId })) });
  }
}

/** The branches a membership or pending invitation is linked to, in screen order. */
export async function linkedBranches(db: Reader, kind: "membership" | "invite", rowId: string): Promise<{ id: string; name: string }[]> {
  const rows = kind === "membership"
    ? await db.membershipBranch.findMany({ where: { membershipId: rowId }, select: { branch: { select: { id: true, name: true, sort: true, createdAt: true } } } })
    : await db.inviteBranch.findMany({ where: { inviteId: rowId }, select: { branch: { select: { id: true, name: true, sort: true, createdAt: true } } } });
  return rows.map((r) => r.branch)
    .sort((a, b) => a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime())
    .map(({ id, name }) => ({ id, name }));
}

/**
 * Rewrites the OLD `scopes` names of limited people from their links (after a branch was renamed or removed), so the old column stays right.
 * A pending invitation left with no branch becomes "all", exactly as the old branch-removal code did (flagged in CHANGES for the Lead).
 */
export async function syncOldNames(tx: Tx, o: { memberships?: readonly string[]; invites?: readonly string[] }): Promise<void> {
  for (const id of o.memberships ?? []) {
    const m = await tx.membership.findUnique({ where: { id }, select: { allBranches: true } });
    if (!m || m.allBranches) continue;
    await tx.membership.update({ where: { id }, data: { scopes: (await linkedBranches(tx, "membership", id)).map((b) => b.name) } });
  }
  for (const id of o.invites ?? []) {
    const i = await tx.invite.findUnique({ where: { id }, select: { allBranches: true, status: true } });
    if (!i || i.allBranches || i.status !== "pending") continue;
    const names = (await linkedBranches(tx, "invite", id)).map((b) => b.name);
    // Left with no branch (its only branch was removed): it stays limited with no branch, never "all" (Lead decision, P1-BE-3
    // review: widening access is never automatic). The person accepting it sees "You aren't given any open branch" until the owner
    // picks one on the Team page.
    await tx.invite.update({ where: { id }, data: { scopes: names } });
  }
}
