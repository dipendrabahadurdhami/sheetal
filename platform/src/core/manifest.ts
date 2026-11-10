// The app manifest type: the identity card of every app (types only, nothing runs here).
// Where it fits: each apps/<id>/app.manifest.ts and platform/src/tenancy/platform.manifest.ts write
// `satisfies AppManifest`; scripts/gen-permissions.mjs and scripts/check-manifests.mjs read the files as data.
// How it works: copied from docs/architecture/APP-MANIFEST.md section 3. Two small, optional additions were needed to
// describe today's rules without losing anything (both marked "added"): `PermissionDecl.types` and `RoleGrant.except`.
// Rules: types only, so a manifest that imports this file keeps to "import type" lines (checker rule 8).

import type { BusinessType } from "../tenancy/types.js";

export type { BusinessType };
export type Text = { en: string; ne?: string };
export type DataScope = "own" | "branch" | "all";

export interface AppManifest {
  manifestVersion: 1;

  /** Folder name and prefix of every permission/event. Lower-case letters, digits, underscore. */
  id: string;
  /** "app" = sold in the Marketplace. "core" = always on (workspace). "platform" = Sheetal staff only. */
  kind: "app" | "core" | "platform";
  name: Text;
  tagline: Text;
  description?: Text;
  /** Icon name from the shared icon set (lucide names). */
  icon: string;
  category: "money" | "sales" | "property" | "hospitality" | "people" | "growth" | "settings";

  /** Business types that are offered the app. A plan with the `all_kinds` feature is offered all of them. */
  businessTypes: readonly BusinessType[] | "all";

  /** Editions with their free limits. DEFAULTS: the admin panel owns the live values. */
  editions: readonly Edition[];
  /** Days of free trial of the paid edition. null = none. DEFAULT. */
  trialDays: number | null;
  limits: readonly LimitDecl[];

  permissions: readonly PermissionDecl[];
  /** Grants this app adds to roles. Merged by role key into the business type's templates (ACCESS.md section 8). */
  roles: readonly RoleGrant[];
  approvals: readonly ApprovalDecl[];

  menu: readonly MenuItem[];

  events: {
    publishes: readonly EventDecl[];
    consumes: readonly EventSub[];
  };

  ai: readonly AiFeature[];

  dependencies: {
    requires: readonly string[];
    optional: readonly string[];
    reads: readonly string[];
  };

  /** Prisma models this app owns. Each carries `/// @app <id>` in schema.prisma; the checker compares both. */
  models: readonly string[];
  /** Models holding branch work, for "this branch has work, close it instead" (ACCESS.md section 3.5). */
  branchOwned: readonly { model: string; label: Text }[];

  settings: readonly SettingDecl[];

  /** Background jobs, registered in platform/jobs. */
  jobs: readonly { id: string; every: string; label: string }[];
}

export interface Edition {
  id: string;
  name: Text;
  free: boolean;
  limits: Record<string, number | null>;
  features: readonly string[];
  /** Default price, in paisa, per month and per year. null = decided in Phase 3 in the admin panel. */
  price: { monthPaisa: number; yearPaisa: number } | null;
}

export interface LimitDecl { key: string; label: Text; unit: "count" | "mb" | "per_month" | "per_day" }

export interface PermissionDecl {
  id: string;
  label: Text;
  scopes: readonly DataScope[];
  default: DataScope | null;
  group?: string;
  approvable?: boolean;
  sensitive?: boolean;
  /** Added: business types that can be given this permission, when narrower than the app's `businessTypes`
   *  (today's `crm.lead.*` are for agencies only while `crm.customer.read` is for every type). */
  types?: readonly BusinessType[];
}

export interface RoleGrant {
  key: string;
  types: readonly BusinessType[] | "all";
  /** Permission ids, optionally with ":scope". "*" and patterns (`workspace.role.*`) only in `roles`. */
  add: readonly string[];
  /** Added: with a pattern in `add`, permissions to leave out (today's manager: everything except roles and billing). */
  except?: readonly string[];
}

export interface ApprovalDecl {
  action: string;
  label: Text;
  money: boolean;
  enabledByDefault: boolean;
  approverPermission: string;
}

export interface MenuItem {
  id: string;
  label: Text;
  icon: string;
  path: string;
  group: "main" | "work" | "money" | "customers" | "growth" | "admin";
  order: number;
  permission?: string;
  anyPermission?: readonly string[];
  badge?: { endpoint: string; field: string };
}

export interface EventDecl {
  name: string;
  v: number;
  label: string;
  payload: Record<string, "string" | "number" | "boolean" | "date" | "paisa" | "id">;
}
export interface EventSub { name: string; handler: string; why: string }

export interface AiFeature {
  id: string;
  name: Text;
  description: Text;
  minutesSaved: number;
  status: "planned" | "preview" | "live";
  permission: string;
}

export interface SettingDecl {
  key: string;
  label: Text;
  scope: "platform" | "business";
  type: "int" | "money" | "bool" | "text" | "select" | "list" | "json";
  default?: unknown;
  legacy?: string;
}
