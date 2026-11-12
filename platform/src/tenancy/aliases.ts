// The alias layer: lets a permission check accept an old name or its new name (ACCESS.md section 6.3, point 1).
// Where it fits: backend-core/src/domain/permissions.ts re-exports hasPerm from here; the same rule is written in JavaScript in
// shared/src/core/rbac.js for the screens (a test runs both against the same cases).
// How it works: `hasPerm(perms, perm)` is true when the role holds "*", or holds `perm` itself, or `perm` is an OLD name and the role
// holds ALL of its new names, or `perm` is a NEW name and the role holds an OLD name that gives it. A grant may carry a scope
// ("expenses.expense.read:branch"); the scope does not change whether the name is held.
// Rules: for a role that holds only old names and a check that uses an old name, the answer is exactly what it was before. Remove this
// file at the end of Phase 1, when no call site uses an old name (ACCESS.md section 6.3, point 4).

import { LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES } from "./permissions.generated.js";
import type { AliasMap } from "./types.js";

/** Old name -> its sets of new names (one set per map: "roles.manage" has a business set and a staff set). */
const oldToNew = new Map<string, string[][]>();
/** New name -> the old names that give it. */
const newToOld = new Map<string, string[]>();

for (const map of [LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES] as AliasMap[]) {
  for (const [old, news] of Object.entries(map)) {
    oldToNew.set(old, [...(oldToNew.get(old) ?? []), news]);
    for (const n of news) newToOld.set(n, [...(newToOld.get(n) ?? []), old]);
  }
}

/** Does the list hold this exact name, with or without a ":scope" suffix? */
function holds(perms: readonly string[], name: string): boolean {
  for (const p of perms) {
    if (p === name) return true;
    if (p.length > name.length && p.charCodeAt(name.length) === 58 && p.startsWith(name)) return true;   // 58 = ":"
  }
  return false;
}

/**
 * Does the list give this permission? `perm` may join several names with "+" ("a.b.read+a.b.update"): then ALL of them are needed. That is how a call site
 * that used one old bundle name ("plans.manage") is written in new names without changing who passes (stage 1.5).
 */
export function hasPerm(perms: readonly string[], perm: string): boolean {
  if (perm.includes("+")) return perm.split("+").every((p) => p !== "" && hasPerm(perms, p));
  if (perms.includes("*") || holds(perms, perm)) return true;
  const sets = oldToNew.get(perm);                                   // perm is an old name: all of its new names
  if (sets && sets.some((set) => set.every((n) => holds(perms, n)))) return true;
  const olds = newToOld.get(perm);                                   // perm is a new name: any old name that gives it
  return !!olds && olds.some((o) => holds(perms, o));
}

/** The new names an old name stands for (business and staff maps joined). Empty when it is not an old name. */
export const newNamesOf = (old: string): string[] => [...new Set((oldToNew.get(old) ?? []).flat())];
/** The old names that give a new name. Empty when it is not an alias target. */
export const oldNamesOf = (name: string): string[] => [...(newToOld.get(name) ?? [])];
