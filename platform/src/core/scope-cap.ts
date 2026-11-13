// The Phase 1 data-scope cap: one copy for every app that has one (Expenses and Reviews today).
// Where it fits: an app's scope.ts wraps the request context with capContext() once per request; the role catalog (tenancy/catalog.ts)
// reads the same table, so the role screen can say "this app is given for a branch only, for now".
// How it works: a role that holds "*" (the owner) or a permission at scope "all" would see every branch even when the top bar picked one; today the
// pages always follow the picked branch (and a limited person sees only their own branches). So for Phase 1 the scope of every permission of these
// apps is capped at "branch", which gives exactly today's rows. A cap never widens: "own" stays "own". The refusal text can be the app's old one.
// Rules: PHASE_ONE_CAPS is the ONE place to change when the "all branches" scope is switched on for an app (a later task, with the new page).
// Nothing else knows the cap. Moved here from apps/expenses/backend/scope.ts and apps/reviews/backend/scope.ts in P1-BE-7 (they were identical).

import { narrowest, type BusinessContext, type DataScope, type PermissionId, type PermissionSet } from "./context.js";

/** App id -> the widest scope its permissions may reach in Phase 1. An app that is not listed has no cap. */
export const PHASE_ONE_CAPS: Readonly<Record<string, DataScope>> = { expenses: "branch", reviews: "branch", people: "branch", agreements: "branch", projects: "branch", investments: "branch", invoicing: "branch" };

export const phaseOneCap = (appId: string): DataScope | null => PHASE_ONE_CAPS[appId] ?? null;

/** The same permissions, every scope no wider than `cap`. `message` is the refusal text of a permission that is not held (when the caller gave none). */
export function capPermissions(p: PermissionSet, cap: DataScope, message?: (perm: PermissionId) => string): PermissionSet {
  return {
    can: (perm) => p.can(perm),
    scopeOf: (perm) => { const s = p.scopeOf(perm); return s ? narrowest(s, cap) : null; },
    require: (perm, msg) => narrowest(p.require(perm, msg ?? message?.(perm)), cap),
    canAny: (perms) => p.canAny(perms),
  };
}

/**
 * The same context with the app's permissions capped. (A transaction opened from it hands out the original context; the services pass the scope they
 * computed from this one, so the cap still holds inside the transaction.) An app with no cap gets the context back unchanged.
 */
export function capContext(ctx: BusinessContext, appId: string, message?: (perm: PermissionId) => string): BusinessContext {
  const cap = phaseOneCap(appId);
  return cap ? { ...ctx, permissions: capPermissions(ctx.permissions, cap, message) } : ctx;
}
