// Permissions: business role templates per business type, and Sheetal staff roles.
// Where it fits: business roles are created from these templates for every new business; the APIs check permissions
// with hasPerm(); the admin API checks staff with PLATFORM_ROLES.
// How it works: since P1-BE-2 this file is a shim. The lists come from platform/src/tenancy/permissions.generated.ts, which
// `npm run gen:permissions` writes from the app manifests; the names and values are exactly the old ones. hasPerm() also accepts
// the new `app.resource.action` name of an old permission and the other way round (platform/src/tenancy/aliases.ts).
// Rules: do not edit the lists here (change a manifest and run the generator). Stored roles still hold the OLD names.

import { hasPerm as hasPermWithAliases } from "@sheetal/platform/tenancy/aliases";
import {
  BUSINESS_TYPE_IDS, LEGACY_ALIASES, LEGACY_BUSINESS_GROUPS, LEGACY_PLATFORM_ALIASES, LEGACY_PLATFORM_GROUPS, LEGACY_PLATFORM_ROLES, LEGACY_TEMPLATES,
} from "@sheetal/platform/tenancy/permissions.generated";
import type { PermGroup } from "@sheetal/platform/tenancy/types";

export const BUSINESS_TYPES = BUSINESS_TYPE_IDS;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_PERMS: PermGroup[] = LEGACY_BUSINESS_GROUPS;
export const PLATFORM_PERMS: PermGroup[] = LEGACY_PLATFORM_GROUPS;

/** Old permission name -> the new names it stands for (ACCESS.md section 6). Added in P1-BE-2. */
export { LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES };

const permsForTypes = (types: readonly BusinessType[]) => BUSINESS_PERMS.filter((g) => g.types === "all" || types.some((t) => (g.types as BusinessType[]).includes(t)));
const allOf = (groups: PermGroup[]) => groups.flatMap((g) => g.perms);

// null = every permission of the type except managing roles and billing (a manager, not an owner).
const TEMPLATES = LEGACY_TEMPLATES;

export function roleTemplatesFor(type: BusinessType): { key: string; perms: string[] }[] {
  const all = allOf(permsForTypes([type]));
  return TEMPLATES[type].map(([key, perms]) => ({ key, perms: perms ?? all.filter((p) => p !== "roles.manage" && p !== "billing.manage") }));
}

export const PLATFORM_ROLES: Record<string, string[]> = LEGACY_PLATFORM_ROLES;

export const hasPerm = (perms: readonly string[], perm: string) => hasPermWithAliases(perms, perm);

/** Every permission id a business of these types can give out (Pro plans see every type's). */
export const businessPermsFor = (types: readonly BusinessType[]) => allOf(permsForTypes(types));
