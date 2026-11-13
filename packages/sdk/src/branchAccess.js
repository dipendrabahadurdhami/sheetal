// Branch access between the team screen (which shows branch NAMES) and the API (which keeps branch IDS): ACCESS.md section 3.
// Where it fits: the Team page (apps/workspace/frontend) sends `branchIds` for invitations and member edits and filters the member list by the picked
// branch id. Moved here from business/frontend/src/access/branchAccess.js in P2-W6 (that path re-exports it).
// How it works: namesToIds() turns "all" or a list of names into "all" or a list of ids using the business's branches. A name that matches no branch (the
// list changed in another tab) makes the answer null, and the caller falls back to sending the names, which the server still accepts.
// Rules: pure functions. Ids are the truth; a renamed branch keeps its people.

/** "all" | names[] -> "all" | ids[]; undefined stays undefined; null when a name is unknown. */
export function namesToIds(scopes, branches) {
  if (scopes === undefined) return undefined;
  if (scopes === "all") return "all";
  const byName = new Map((branches || []).map((b) => [b.name, b.id]));
  const ids = [];
  for (const n of scopes) {
    const id = byName.get(n);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

/** The branch part of a team request body: `branchIds` when every name is known, otherwise the old `scopes`. */
export function branchBody(scopes, branches) {
  const ids = namesToIds(scopes, branches);
  if (ids === undefined) return {};
  return ids === null ? { scopes } : { branchIds: ids };
}

/** Does this member work at the picked branch? `branchId` is "all" or an id; a member without ids (sample data) is matched by name. */
export function worksAt(member, branchId, branchName) {
  if (!branchId || branchId === "all") return true;
  if (member.branchIds !== undefined) return member.branchIds === "all" || member.branchIds.includes(branchId);
  return member.scopes === "all" || (member.scopes || []).includes(branchName);
}
