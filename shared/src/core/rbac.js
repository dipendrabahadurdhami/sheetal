// Permissions, role templates and business types for the screens.
// Where it fits: menus and buttons hide what a role can't do (the server checks again).
// How it works: can(role, perm) and canAny(role, perms). A role holds "*" or grants in the manifests' names ("crm.lead.read:branch"); a check names a
// permission, or several joined with "+" (all are needed). The lists come from @sheetal/config/permissions, which `npm run gen:permissions` writes from
// the app manifests: the catalog (with its labels), the built-in roles of each business type and the staff roles.
// Rules: do not edit the lists here (change a manifest and run the generator). Only the manifests' names are understood: the old names ("leads.view")
// ended with stage 1.5. The same rule runs on the server (platform/src/tenancy/perms.ts); a test runs both on the same cases.

import { APPS } from "@sheetal/config/apps";
import { BUSINESS_TYPE_DEFS, PERMISSION_CATALOG, PLATFORM_ROLE_TEMPLATES_V2, ROLE_TEMPLATES_V2 } from "@sheetal/config/permissions";

export const BUSINESS_TYPES = BUSINESS_TYPE_DEFS;

const APP_NAME = Object.fromEntries(APPS.map((a) => [a.id, a.name?.en || a.id]));
/** The catalog as the groups a role screen shows: one per app and group, with the label of each permission. */
function groupsOf(entries) {
  const out = [];
  for (const p of entries) {
    const key = `${p.app}:${p.group || ""}`;
    let g = out.find((x) => x.module === key);
    if (!g) {
      const app = p.app === "platform" ? "" : APP_NAME[p.app] || p.app;
      g = { module: key, title: [app, p.group].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(": ") || "Other", types: p.types, perms: [], labels: {} };
      out.push(g);
    }
    g.perms.push(p.id);
    g.labels[p.id] = p.label;
  }
  return out;
}

// Business workspace permissions. `types` = which business types see the group.
export const BUSINESS_PERMS = groupsOf(PERMISSION_CATALOG.filter((p) => p.app !== "platform"));
// Sheetal staff permissions for /admin.
export const PLATFORM_PERMS = groupsOf(PERMISSION_CATALOG.filter((p) => p.app === "platform"));

const forTypes = (types) => groupsOf(PERMISSION_CATALOG.filter((p) => p.app !== "platform" && (p.types === "all" || types.some((x) => p.types.includes(x)))));
export const permsForType = (type) => forTypes([type]);
export const permsForTypes = (types) => forTypes(types);
const allOf = (groups) => groups.flatMap((g) => g.perms);

/** The built-in roles of a business type, as a new business gets them: grants with their scope; the owner holds "*". */
export function roleTemplatesFor(type) {
  return ROLE_TEMPLATES_V2[type].map((r) => ({ key: r.key, system: true, name: null, perms: [...r.grants] }));
}

export const PLATFORM_ROLE_TEMPLATES = PLATFORM_ROLE_TEMPLATES_V2.map((r) => ({ key: r.key, perms: [...r.grants], system: true, name: null }));

/** Does the list hold this exact name, with or without a ":scope" suffix? */
export function holds(perms, name) {
  for (const p of perms) {
    if (p === name) return true;
    if (p.length > name.length && p.charCodeAt(name.length) === 58 && p.startsWith(name)) return true;   // 58 = ":"
  }
  return false;
}

// `perm` may join several names with "+": then ALL of them are needed (the same rule as the server).
function hasPerm(perms, perm) {
  if (perm.includes("+")) return perm.split("+").every((p) => p !== "" && hasPerm(perms, p));
  return perms.includes("*") || holds(perms, perm);
}

export const can = (role, perm) => !!role && hasPerm(role.perms, perm);
export const canAny = (role, perms) => perms.some((p) => can(role, p));
export const roleName = (role, t) => (!role ? "—" : role.system ? t(`role.${role.key}`) : role.name);
export const roleDesc = (role, t) => (!role ? "" : role.system ? t(`roledesc.${role.key}`) : role.desc || "");
export const permCount = (role, groups) => (role.perms.includes("*") ? allOf(groups).length : allOf(groups).filter((p) => holds(role.perms, p)).length);

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
