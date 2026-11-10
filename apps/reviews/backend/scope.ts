// The data scope Reviews uses in Phase 1, and the old refusal messages.
// Where it fits: the controller wraps the request context with `phaseOneContext()` once per request.
// How it works: a role that holds "*" (the owner) or a permission at scope "all" would see every branch even when the top bar picked one; today the page always
// follows the picked branch (and a limited person sees only their own branches). So for Phase 1 the scope of every Reviews permission is capped at "branch",
// which gives exactly today's rows. The refusal messages are the old ones, so the screens show the same text.
// Rules: one constant to change when the "all branches" scope is switched on for Reviews (same as Expenses). Nothing else in the app knows the cap.

import { narrowest, type BusinessContext, type DataScope, type PermissionId, type PermissionSet } from "@sheetal/platform/core/context";

const CAP: DataScope = "branch";

const message = (perm: PermissionId): string => (/\.reply$/.test(perm) ? "Your role can't reply to reviews." : "Your role can't see reviews.");

export function cappedPermissions(p: PermissionSet, cap: DataScope = CAP): PermissionSet {
  return {
    can: (perm) => p.can(perm),
    scopeOf: (perm) => { const s = p.scopeOf(perm); return s ? narrowest(s, cap) : null; },
    require: (perm, msg) => narrowest(p.require(perm, msg ?? message(perm)), cap),
    canAny: (perms) => p.canAny(perms),
  };
}

/** The same context with the capped permissions. (A transaction opened from it hands out the original context; the service passes the scope it computed here.) */
export const phaseOneContext = (ctx: BusinessContext): BusinessContext => ({ ...ctx, permissions: cappedPermissions(ctx.permissions) });
