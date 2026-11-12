// Permissions, role templates and business types for the screens.
// Where it fits: menus and buttons hide what a role can't do (the server checks again).
// How it works: can(role, perm) and canAny(role, perms); labels come from i18n (perm.*, role.*). Since P1-BE-2 the lists come from
// @sheetal/config/permissions (generated from the app manifests by `npm run gen:permissions`); the names and values are the old ones.
// can() also accepts the new `app.resource.action` name of an old permission and the other way round (the alias layer, ACCESS.md 6.3).
// Rules: do not edit the lists here (change a manifest and run the generator). Stored roles still hold the OLD names.

import {
  BUSINESS_TYPE_DEFS, LEGACY_ALIASES, LEGACY_BUSINESS_GROUPS, LEGACY_PLATFORM_ALIASES, LEGACY_PLATFORM_GROUPS, LEGACY_PLATFORM_ROLES, LEGACY_TEMPLATES,
} from "@sheetal/config/permissions";

export const BUSINESS_TYPES = BUSINESS_TYPE_DEFS;

// Old permission name -> the new names it stands for (ACCESS.md section 6). Added in P1-BE-2.
export { LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES };

// Business workspace permissions. `types` = which business types see the group.
export const BUSINESS_PERMS = LEGACY_BUSINESS_GROUPS;

// Sheetal staff permissions for /admin.
export const PLATFORM_PERMS = LEGACY_PLATFORM_GROUPS;

export const permsForType = (type) => BUSINESS_PERMS.filter((g) => g.types === "all" || g.types.includes(type));
export const permsForTypes = (types) => BUSINESS_PERMS.filter((g) => g.types === "all" || types.some((x) => g.types.includes(x)));
const allOf = (groups) => groups.flatMap((g) => g.perms);

const T = LEGACY_TEMPLATES;

export function roleTemplatesFor(type) {
  const all = allOf(permsForType(type));
  return T[type].map(([key, perms]) => ({
    key, system: true, name: null,
    perms: perms || all.filter((p) => p !== "roles.manage" && p !== "billing.manage"),
  }));
}

export const PLATFORM_ROLE_TEMPLATES = Object.entries(LEGACY_PLATFORM_ROLES).map(([key, perms]) => ({ key, perms, system: true, name: null }));

// ── The alias layer: the same rule as platform/src/tenancy/aliases.ts (a test runs both on the same cases). ──
const oldToNew = new Map();   // old name -> list of sets of new names (business set and/or staff set)
const newToOld = new Map();   // new name -> old names that give it
for (const map of [LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES]) {
  for (const [old, news] of Object.entries(map)) {
    oldToNew.set(old, [...(oldToNew.get(old) || []), news]);
    for (const n of news) newToOld.set(n, [...(newToOld.get(n) || []), old]);
  }
}
// Does the list hold this exact name, with or without a ":scope" suffix?
function holds(perms, name) {
  for (const p of perms) {
    if (p === name) return true;
    if (p.length > name.length && p.charCodeAt(name.length) === 58 && p.startsWith(name)) return true;
  }
  return false;
}
// `perm` may join several names with "+": then ALL of them are needed (the same rule as the server; stage 1.5).
function hasPerm(perms, perm) {
  if (perm.includes("+")) return perm.split("+").every((p) => p !== "" && hasPerm(perms, p));
  if (perms.includes("*") || holds(perms, perm)) return true;
  const sets = oldToNew.get(perm);
  if (sets && sets.some((set) => set.every((n) => holds(perms, n)))) return true;
  const olds = newToOld.get(perm);
  return !!olds && olds.some((o) => holds(perms, o));
}

export const can = (role, perm) => !!role && hasPerm(role.perms, perm);
export const canAny = (role, perms) => perms.some((p) => can(role, p));
export const roleName = (role, t) => (!role ? "—" : role.system ? t(`role.${role.key}`) : role.name);
export const roleDesc = (role, t) => (!role ? "" : role.system ? t(`roledesc.${role.key}`) : role.desc || "");
export const permCount = (role, groups) => (role.perms.includes("*") ? allOf(groups).length : role.perms.filter((p) => allOf(groups).includes(p)).length);

// Hide nav items the role can't use, drop empty groups. `type` is one business type or a list (Pro plans see every type).
export function filterNav(nav, role, type) {
  const types = [].concat(type);
  return nav
    .map((g) => ({ ...g, items: g.items.filter((it) =>
      (!it.types || it.types.some((x) => types.includes(x))) &&
      (!it.perm || can(role, it.perm)) &&
      (!it.permAny || canAny(role, it.permAny))) }))
    .filter((g) => g.items.length);
}
