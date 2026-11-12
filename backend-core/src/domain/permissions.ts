// Permissions and built-in roles, for the server code that still imports them from here (ACCESS.md sections 4 to 7).
// Where it fits: createWorkspace() gives a new business its built-in roles from roleTemplatesFor(); the business API checks a membership's role with
// hasPerm(); the admin API checks staff with PLATFORM_ROLES. The data is not written here: `npm run gen:permissions` writes it from the app manifests
// (ROLE_TEMPLATES_V2, PLATFORM_ROLE_TEMPLATES_V2, PERMISSION_CATALOG in platform/src/tenancy/permissions.generated.ts).
// Rules: only the manifests' names ("crm.lead.read:branch"). The old names ("leads.view") ended with stage 1.5: stored roles were rewritten by
// scripts/rewrite-role-perms.mjs and nothing here understands them. A new permission is added in an app's manifest, never here.

import { hasPerm } from "@sheetal/platform/tenancy/perms";
import { catalogForTypes } from "@sheetal/platform/tenancy/catalog";
import { BUSINESS_TYPE_IDS, ROLE_TEMPLATES_V2 } from "@sheetal/platform/tenancy/permissions.generated";
import { STAFF_ROLES } from "@sheetal/platform/tenancy/staff-roles";

export const BUSINESS_TYPES = BUSINESS_TYPE_IDS;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** The built-in roles of a business type, as stored: grants with their scope ("expenses.expense.read:branch"); the owner holds "*". */
export function roleTemplatesFor(type: BusinessType): { key: string; perms: string[] }[] {
  return ROLE_TEMPLATES_V2[type].map((r) => ({ key: r.key, perms: [...r.grants] }));
}

/** Staff role -> its permissions. Fixed in code; a user row only names its role. */
export const PLATFORM_ROLES: Record<string, string[]> = STAFF_ROLES;

export { hasPerm };

/** Every permission id a business of these types can give out (Pro plans see every type's). */
export const businessPermsFor = (types: readonly BusinessType[]): string[] => catalogForTypes(types).map((e) => e.id);
