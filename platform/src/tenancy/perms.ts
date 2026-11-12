// Does a stored permission list give a permission? The one rule for the server (ACCESS.md sections 4 and 6.3, after stage 1.5).
// Where it fits: backend-core/src/domain/permissions.ts re-exports hasPerm; context.ts builds every PermissionSet on it; notify finds staff with it.
// The screens have the same rule in JavaScript (shared/src/core/rbac.js); platform/test/tenancy-context.test.ts runs both against the same cases.
// How it works: a role holds "*" (everything) or grants "app.resource.action" with an optional ":scope". A check names a permission, or several joined
// with "+" (all are needed). The scope does not change whether a name is held.
// Rules: only the names of the app manifests. The old dotted names are NOT understood here any more: stored roles were rewritten by
// backend-core/scripts/rewrite-role-perms.mjs (the old list is kept in roles.perms_v1), and a test forbids an old name anywhere outside that script.

/** Does the list hold this exact name, with or without a ":scope" suffix? */
export function holds(perms: readonly string[], name: string): boolean {
  for (const p of perms) {
    if (p === name) return true;
    if (p.length > name.length && p.charCodeAt(name.length) === 58 && p.startsWith(name)) return true;   // 58 = ":"
  }
  return false;
}

/** Does the list give this permission? `perm` may join several names with "+" ("a.b.read+a.b.update"): then ALL of them are needed. */
export function hasPerm(perms: readonly string[], perm: string): boolean {
  if (perm.includes("+")) return perm.split("+").every((p) => p !== "" && hasPerm(perms, p));
  return perms.includes("*") || holds(perms, perm);
}
