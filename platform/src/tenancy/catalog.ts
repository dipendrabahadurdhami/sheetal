// The permission catalog of a business, and the role maths between old and new permission names (ACCESS.md sections 4, 5 and 6).
// Where it fits: the Team routes (business/backend/src/modules/team/routes.ts) offer `catalogFor…()` to the role screen, check a role being saved with
// normalizeRolePerms(), and send every role's `grants` (toGrants) so the screen can show new names whatever the role stores. The approvals rules screen uses
// the same catalog. It replaces businessPermsFor() (the old names) at the end of Phase 1; both exist side by side until BE-10.
// How it works:
//   catalogForTypes()   the permissions of the apps a business of these types has, each with the scopes the manifest allows, its default, and `cap`: the widest
//                       scope the app can be given in Phase 1 (core/scope-cap.ts: Expenses and Reviews are "branch" for now, so the screen offers no "all").
//   toGrants()          a stored permission list (old names, new names, with or without ":scope", or "*") as NEW names with an explicit scope. "*" stays "*".
//                       An old name becomes all the new names it stands for, at their default scope (nobody gains or loses anything: ACCESS.md 5.1).
//   normalizeRolePerms() what the role routes do with the list a screen sends: an OLD name is accepted and kept as sent (stored roles may still hold old names
//                       until the rewrite, and the old screen and tests send them); a NEW name must be in the catalog, its scope one the manifest lists and no wider
//                       than the app's cap, and it is stored with the scope written out ("expenses.expense.read:branch"), so a later change of a manifest default never
//                       changes an old role.
// Rules: pure functions over the generated tables, no database. A scope above an app's cap is refused with a plain sentence, never silently narrowed when the person
// typed it; a name with no scope gets the manifest default (narrowed to the cap).

import { narrowest, type DataScope } from "../core/context.js";
import { phaseOneCap } from "../core/scope-cap.js";
import { APPS } from "./apps.generated.js";
import { PERMISSION_CATALOG } from "./permissions.generated.js";

export interface CatalogEntry {
  id: string;
  app: string;
  appName: string;
  label: string;
  group: string | null;
  /** The scopes the manifest allows for it. */
  scopes: readonly DataScope[];
  default: DataScope | null;
  approvable: boolean;
  sensitive: boolean;
  /** The widest scope the app can be given for now (Phase 1), or null when there is no cap. The screen shows no wider choice. */
  cap: DataScope | null;
}

const RANK: Record<DataScope, number> = { own: 0, branch: 1, all: 2 };
const isScope = (s: string): s is DataScope => s === "own" || s === "branch" || s === "all";
const BY_ID = new Map(PERMISSION_CATALOG.map((p) => [p.id, p]));
const APP_ORDER = new Map(APPS.map((a, i) => [a.id, i]));
const APP_BY_ID = new Map(APPS.map((a) => [a.id, a]));

/** Is the app offered to a business of these types? (The same rule as buildEntitlements().hasApp: core apps, apps for every type, apps listing one of the types.) */
function offered(appId: string, types: readonly string[]): boolean {
  const app = APP_BY_ID.get(appId);
  if (!app || app.id === "platform") return false;
  return app.kind === "core" || app.businessTypes === "all" || types.some((t) => (app.businessTypes as readonly string[]).includes(t));
}

/** The permissions a business of these types can give out. Pass every type for a plan with `all_kinds`. */
export function catalogForTypes(types: readonly string[]): CatalogEntry[] {
  return PERMISSION_CATALOG
    .filter((p) => p.app !== "platform" && offered(p.app, types) && (p.types === "all" || types.some((t) => (p.types as readonly string[]).includes(t))))
    .sort((a, b) => (APP_ORDER.get(a.app) ?? 99) - (APP_ORDER.get(b.app) ?? 99))
    .map((p) => ({
      id: p.id, app: p.app, appName: APP_BY_ID.get(p.app)?.name.en ?? p.app, label: p.label.en, group: p.group, scopes: p.scopes, default: p.default,
      approvable: p.approvable, sensitive: p.sensitive, cap: phaseOneCap(p.app),
    }));
}

/** The default scope of a permission as a grant gets it: the manifest default (or "all"), no wider than the app's cap. */
function scopeFor(id: string): DataScope {
  const info = BY_ID.get(id);
  const d = info?.default ?? "all";
  const cap = info ? phaseOneCap(info.app) : null;
  return cap ? narrowest(d, cap) : d;
}

/** "name" or "name:scope" -> [name, scope or null]. */
function split(perm: string): [string, string | null] {
  const i = perm.lastIndexOf(":");
  return i < 0 ? [perm, null] : [perm.slice(0, i), perm.slice(i + 1)];
}

/** A stored permission list with an explicit scope on every grant, in catalog order. "*" alone means everything. Names no manifest declares are left out. */
export function toGrants(perms: readonly string[]): string[] {
  if (perms.includes("*")) return ["*"];
  const held = new Map<string, DataScope>();
  const give = (id: string, scope: DataScope) => {
    const was = held.get(id);
    if (!was || RANK[scope] > RANK[was]) held.set(id, scope);
  };
  for (const p of perms) {
    const [name, suffix] = split(p);
    if (BY_ID.has(name)) { give(name, suffix && isScope(suffix) ? suffix : scopeFor(name)); continue; }
  }
  const order = new Map(PERMISSION_CATALOG.map((p, i) => [p.id, i]));
  return [...held].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)).map(([id, s]) => `${id}:${s}`);
}

export interface NormalizedRole {
  /** What to store. */
  perms: string[];
  /** Names that are neither an allowed old name nor in the catalog (the old "Unknown permissions" message). */
  unknown: string[];
  /** Plain sentences for a scope the manifest does not allow, or one wider than the app's cap. */
  refused: string[];
}

export function normalizeRolePerms(perms: readonly string[], o: { catalog: readonly CatalogEntry[]; oldAllowed: ReadonlySet<string> }): NormalizedRole {
  const byId = new Map(o.catalog.map((e) => [e.id, e]));
  const out = new Set<string>();
  const unknown: string[] = [];
  const refused: string[] = [];
  for (const p of perms) {
    if (o.oldAllowed.has(p)) { out.add(p); continue; }            // an old name: kept as sent
    const [name, suffix] = split(p);
    const e = byId.get(name);
    if (!e) { unknown.push(p); continue; }
    let scope: DataScope;
    if (suffix !== null) {
      if (!isScope(suffix) || !e.scopes.includes(suffix)) { refused.push(`"${e.label}" can't be given for "${suffix}" here.`); continue; }
      if (e.cap && RANK[suffix] > RANK[e.cap]) { refused.push(`${e.appName} can only be given for ${e.cap === "branch" ? "a branch" : e.cap} for now: "${e.label}".`); continue; }
      scope = suffix;
    } else {
      scope = e.default ?? "all";
      if (e.cap) scope = narrowest(scope, e.cap);
    }
    out.add(`${name}:${scope}`);
  }
  return { perms: [...out], unknown, refused };
}
