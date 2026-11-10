// manifests: loads the app manifests and builds the permission model from them (shared by the generator and the checker).
// Where it fits: scripts/gen-permissions.mjs and scripts/check-manifests.mjs both import this file, so they always agree.
// How it works: manifests are TypeScript files that hold plain data. They are loaded with tsx's programmatic API
// (`tsImport`), which is already installed in the repo (backend-core uses `tsx`), so no new package is needed. The model
// is built by pure functions with no file access, which makes them easy to test.
// Rules: read-only; never writes anything. A manifest that fails to load stops the script with its file name.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const PLATFORM_MANIFEST = "platform/src/tenancy/platform.manifest.ts";
export const TYPES_FILE = "platform/src/tenancy/types.ts";
export const LEGACY_FILE = "platform/src/tenancy/legacy-v1.ts";
export const SCHEMA_FILE = "backend-core/prisma/schema.prisma";

const abs = (rel) => path.join(ROOT, rel);

async function loadTs(rel) {
  const { tsImport } = await import("tsx/esm/api");
  try {
    return await tsImport(pathToFileURL(abs(rel)).href, pathToFileURL(abs("scripts/lib/manifests.mjs")).href);
  } catch (e) {
    throw new Error(`could not load ${rel}: ${e.message}`);
  }
}

/** Every manifest file, as repo-relative paths: apps/<id>/app.manifest.ts and the platform one. */
export function manifestFiles() {
  const dir = abs("apps");
  const apps = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  const files = apps.filter((a) => existsSync(abs(`apps/${a}/app.manifest.ts`))).map((a) => `apps/${a}/app.manifest.ts`);
  if (existsSync(abs(PLATFORM_MANIFEST))) files.push(PLATFORM_MANIFEST);
  return files;
}

/** Loads everything the model needs. */
export async function loadInputs() {
  const files = manifestFiles();
  const manifests = [];
  for (const file of files) {
    const mod = await loadTs(file);
    manifests.push({ file, manifest: mod.default, text: readFileSync(abs(file), "utf8") });
  }
  const types = await loadTs(TYPES_FILE);
  const legacy = await loadTs(LEGACY_FILE);
  return { manifests, businessTypeDefs: types.BUSINESS_TYPE_DEFS, legacy };
}

// ── Pure helpers ──

const KIND_ORDER = { core: 0, app: 1, platform: 2 };

/** Core first, then apps by id, then platform: a fixed order so the generated files never shuffle. */
export function ordered(manifests) {
  return [...manifests].sort((a, b) => (KIND_ORDER[a.manifest.kind] - KIND_ORDER[b.manifest.kind]) || a.manifest.id.localeCompare(b.manifest.id));
}

export const stripScope = (grant) => (grant.includes(":") ? grant.slice(0, grant.indexOf(":")) : grant);
export const scopeOf = (grant) => (grant.includes(":") ? grant.slice(grant.indexOf(":") + 1) : null);

/** "workspace.role.*" matches "workspace.role.read"; a "*" matches exactly one segment (ACCESS.md section 8). */
export function matchPattern(pattern, id) {
  const p = pattern.split(".");
  const s = id.split(".");
  return p.length === s.length && p.every((seg, i) => seg === "*" || seg === s[i]);
}

/** Business types a permission can be given to (its own `types`, else its app's `businessTypes`), as an array. */
export function typesOfPermission(decl, manifest, allTypes) {
  const t = decl.types ?? manifest.businessTypes;
  return t === "all" ? [...allTypes] : [...t];
}

/**
 * Builds the model: the catalog, the role templates in the new names, the legacy data and problems found on the way.
 * `problems` are things only this step can see (a role that grants one permission at two scopes, a pattern that matches nothing).
 */
export function buildModel({ manifests, businessTypeDefs, legacy }) {
  const sorted = ordered(manifests);
  const allTypes = Object.keys(businessTypeDefs);
  const problems = [];
  const catalog = [];
  const byId = new Map();
  for (const { manifest } of sorted) {
    for (const p of manifest.permissions) {
      const info = {
        id: p.id, app: manifest.id, label: p.label, scopes: [...p.scopes], default: p.default, group: p.group ?? null,
        approvable: p.approvable === true, sensitive: p.sensitive === true,
        types: manifest.kind === "platform" ? "all" : typesOfPermission(p, manifest, allTypes).length === allTypes.length ? "all" : typesOfPermission(p, manifest, allTypes),
      };
      if (byId.has(p.id)) problems.push(`permission ${p.id} is declared twice`);
      byId.set(p.id, info);
      catalog.push(info);
    }
  }
  const business = sorted.filter((m) => m.manifest.kind !== "platform");
  const core = sorted.filter((m) => m.manifest.kind === "core");
  const businessCatalog = catalog.filter((c) => byId.get(c.id).app !== "platform");
  const availableTo = (type) => businessCatalog.filter((c) => c.types === "all" || c.types.includes(type));

  const grantOf = (id) => { const c = byId.get(id); return c && c.default ? `${id}:${c.default}` : id; };

  /** Turns one `add` list (with patterns and "except") into plain grants. */
  function expand(entry, type, where) {
    const out = [];
    for (const token of entry.add) {
      if (token === "*" && !entry.except) { out.push("*"); continue; }
      if (token.includes("*")) {
        const pool = type ? availableTo(type) : businessCatalog;
        const hits = pool.filter((c) => (token === "*" || matchPattern(token, c.id)) && !(entry.except ?? []).some((x) => matchPattern(x, c.id)));
        if (hits.length === 0) problems.push(`${where}: pattern ${token} matches no permission`);
        for (const h of hits) out.push(grantOf(h.id));
        continue;
      }
      out.push(token);
    }
    for (const x of entry.except ?? []) {
      if (!businessCatalog.some((c) => matchPattern(x, c.id))) problems.push(`${where}: except pattern ${x} matches no permission`);
    }
    return out;
  }

  function merge(into, grants, where) {
    for (const g of grants) {
      if (g === "*") { if (!into.includes("*")) into.push("*"); continue; }
      const name = stripScope(g);
      const have = into.find((x) => stripScope(x) === name);
      if (!have) into.push(g);
      else if (have !== g) problems.push(`${where}: ${name} is granted at two scopes (${have} and ${g})`);
    }
  }

  // Business role templates: the core manifest says which roles a type has; every manifest adds grants to the roles that exist.
  const roleTemplates = {};
  for (const type of allTypes) {
    const roles = [];
    const find = (key) => roles.find((r) => r.key === key);
    for (const { manifest } of core) {
      for (const entry of manifest.roles) {
        if (entry.types !== "all" && !entry.types.includes(type)) continue;
        const where = `${manifest.id} role ${entry.key} (${type})`;
        const role = find(entry.key) ?? (roles.push({ key: entry.key, grants: [] }), roles[roles.length - 1]);
        merge(role.grants, expand(entry, type, where), where);
      }
    }
    for (const { manifest } of business) {
      if (manifest.kind === "core") continue;
      for (const entry of manifest.roles) {
        if (entry.types !== "all" && !entry.types.includes(type)) continue;
        const role = find(entry.key);
        if (!role) continue;   // "ignored if the type has no such role"
        const where = `${manifest.id} role ${entry.key} (${type})`;
        merge(role.grants, expand(entry, type, where), where);
      }
    }
    roleTemplates[type] = roles;
  }

  // Staff roles: the platform manifest lists them directly.
  const platformRoles = [];
  for (const { manifest } of sorted.filter((m) => m.manifest.kind === "platform")) {
    for (const entry of manifest.roles) {
      const where = `${manifest.id} role ${entry.key}`;
      const role = platformRoles.find((r) => r.key === entry.key) ?? (platformRoles.push({ key: entry.key, grants: [] }), platformRoles[platformRoles.length - 1]);
      merge(role.grants, expand(entry, null, where), where);
    }
  }

  // The old name -> new names maps and their reverse.
  const reverse = (map) => {
    const r = {};
    for (const [old, news] of Object.entries(map)) for (const n of news) (r[n] ??= []).push(old);
    return r;
  };

  return {
    sorted, allTypes, catalog, byId, problems, roleTemplates, platformRoles,
    businessAliases: legacy.LEGACY_ALIASES, platformAliases: legacy.LEGACY_PLATFORM_ALIASES,
    newToOldBusiness: reverse(legacy.LEGACY_ALIASES), newToOldPlatform: reverse(legacy.LEGACY_PLATFORM_ALIASES),
  };
}
