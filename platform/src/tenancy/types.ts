// Tenancy types and the list of business types.
// Where it fits: the manifests (`import type { BusinessType }`), the generator (it reads BUSINESS_TYPE_DEFS as data) and the
// permission shim in backend-core. Design: docs/architecture/APP-MANIFEST.md section 3 and ACCESS.md section 4.
// How it works: BUSINESS_TYPE_DEFS is the one place the five business types and their icons are written (the screens'
// BUSINESS_TYPES object and the server's list are both generated from it). The other types describe the generated files.
// Rules: plain data and types only, no imports of runtime code, so the generator can load it with no setup.

export const BUSINESS_TYPE_DEFS = {
  hotel: { icon: "bed-double" },
  host: { icon: "house" },
  developer: { icon: "building-2" },
  agency: { icon: "briefcase" },
  sponsor: { icon: "hand-coins" },
} as const;

export type BusinessType = keyof typeof BUSINESS_TYPE_DEFS;

export type DataScope = "own" | "branch" | "all";

/** One group of permissions as the old screens and APIs list them (module = the old group name). */
export interface PermGroup { module: string; types: "all" | BusinessType[]; perms: string[] }

/** One permission of the new catalog (`app.resource.action`), as declared in a manifest. */
export interface PermissionInfo {
  id: string;
  app: string;
  label: { en: string; ne?: string };
  scopes: readonly DataScope[];
  default: DataScope | null;
  group: string | null;
  approvable: boolean;
  sensitive: boolean;
  /** Business types that can be given it. "all" = every type. */
  types: "all" | readonly BusinessType[];
}

/** A role template in the new names: grants are "<permission>" or "<permission>:<scope>", or "*". */
export interface RoleTemplateV2 { key: string; grants: string[] }

/** Old name -> new names (ACCESS.md section 6.3, point 1). */
export type AliasMap = Record<string, string[]>;
