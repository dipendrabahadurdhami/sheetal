// The permissions of each Sheetal staff role, in the manifest's names (ACCESS.md section 7).
// Where it fits: context.ts (the admin API's StaffContext), notify (who gets a staff notice) and backend-core/src/domain/permissions.ts (PLATFORM_ROLES)
// all read this one map. It comes from PLATFORM_ROLE_TEMPLATES_V2, which `npm run gen:permissions` writes from the platform manifest.
// Rules: staff roles are fixed in code, not stored per person: a user row only names its role. A Map, so a role string like "constructor" or "__proto__"
// can never match something inherited from Object.prototype.

import { PLATFORM_ROLE_TEMPLATES_V2 } from "./permissions.generated.js";

export const STAFF_GRANTS: ReadonlyMap<string, readonly string[]> = new Map(PLATFORM_ROLE_TEMPLATES_V2.map((r) => [r.key, r.grants]));
/** The same as a plain record without a prototype, for code that reads PLATFORM_ROLES[role]. */
export const STAFF_ROLES: Record<string, string[]> = Object.assign(Object.create(null) as Record<string, string[]>, Object.fromEntries(PLATFORM_ROLE_TEMPLATES_V2.map((r) => [r.key, [...r.grants]])));
