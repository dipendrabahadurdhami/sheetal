// The maths of the role screen on the NEW permission names (ACCESS.md sections 4, 5 and 8).
// Where it fits: pages/LiveRoles.jsx (Business → Team → Roles, signed in) reads the role list (`grants`) and the `catalog` from GET /team and uses these
// helpers to show, change and save a role. The server checks everything again (platform/src/tenancy/catalog.ts: normalizeRolePerms).
// How it works: a grant is "app.resource.action:scope". The catalog entry of a permission lists the scopes its manifest allows and `cap`, the widest scope
// the app can be given for now (Phase 1: Expenses and Reviews are capped at "branch"), so the screen never offers a wider one.
// Rules: pure functions, no React, no API. Nothing here widens a scope: an unknown or too-wide scope falls back to the default the server would use.

const RANK = { own: 0, branch: 1, all: 2 };
export const SCOPE_LABEL = { own: "Only their own records", branch: "Their branches", all: "All branches" };

/** The scopes the screen may offer for one permission: the manifest's, no wider than the app's cap, narrowest first. */
export function scopesOffered(entry) {
  const list = (entry.scopes || []).filter((s) => RANK[s] !== undefined && (!entry.cap || RANK[s] <= RANK[entry.cap]));
  return [...list].sort((a, b) => RANK[a] - RANK[b]);
}

/** The scope a newly ticked permission gets: the manifest default, narrowed to the cap (the same rule as the server). */
export function defaultScope(entry) {
  const offered = scopesOffered(entry);
  if (!offered.length) return entry.default || "all";
  const want = entry.default || "all";
  if (offered.includes(want)) return want;
  // The default is wider than the cap: the widest scope still allowed.
  return offered[offered.length - 1];
}

/** ["a.b.c:branch", …] -> { "a.b.c": "branch" }. "*" (the owner) gives every catalog permission at its widest offered scope. */
export function grantsToMap(grants, catalog) {
  const out = {};
  if ((grants || []).includes("*")) {
    for (const e of catalog) { const o = scopesOffered(e); out[e.id] = o[o.length - 1] || defaultScope(e); }
    return out;
  }
  const byId = new Map(catalog.map((e) => [e.id, e]));
  for (const g of grants || []) {
    const i = g.lastIndexOf(":");
    const id = i < 0 ? g : g.slice(0, i);
    const scope = i < 0 ? null : g.slice(i + 1);
    const e = byId.get(id);
    if (!e) continue;                       // a permission of an app this business does not have: not shown, not sent
    out[id] = scope && scopesOffered(e).includes(scope) ? scope : defaultScope(e);
  }
  return out;
}

/** { "a.b.c": "branch" } -> ["a.b.c:branch", …] in catalog order: what the role routes store. */
export function mapToPerms(map, catalog) {
  return catalog.filter((e) => map[e.id]).map((e) => `${e.id}:${map[e.id]}`);
}

/** The catalog as the screen shows it: one block per app, the permissions grouped as the manifest groups them. */
export function catalogByApp(catalog) {
  const apps = [];
  for (const e of catalog) {
    let app = apps.find((a) => a.id === e.app);
    if (!app) { app = { id: e.app, name: e.appName, cap: e.cap || null, groups: [] }; apps.push(app); }
    const name = e.group || e.appName;
    let group = app.groups.find((g) => g.name === name);
    if (!group) { group = { name, entries: [] }; app.groups.push(group); }
    group.entries.push(e);
  }
  return apps;
}

/** The short note for an app whose scope is capped for now, or null. */
export function capNote(app) {
  if (!app.cap || app.cap === "all") return null;
  return app.cap === "branch"
    ? `${app.name} is given branch by branch for now. "All branches" comes later.`
    : `${app.name} is limited to a person's own records for now.`;
}

/** Same grants on both sides? (For the "unsaved changes" line.) */
export function sameMap(a, b) {
  const ka = Object.keys(a).filter((k) => a[k]).sort();
  const kb = Object.keys(b).filter((k) => b[k]).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/** How many of the catalog's permissions a role holds (the "12 on" in the role list). */
export const grantCount = (grants, catalog) => Object.keys(grantsToMap(grants, catalog)).length;
