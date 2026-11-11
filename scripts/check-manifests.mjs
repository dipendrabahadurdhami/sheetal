// check-manifests: checks every app manifest is complete and consistent (APP-MANIFEST.md section 9, rules 1 to 8).
// Where it fits: part of `npm run check`. A broken rule fails the build; warnings are printed and do not.
// How it works: loads the manifests as data (same loader as the generator), reads backend-core/prisma/schema.prisma as text, and
// applies the rules. Extra checks (marked "extra") prove the manifests agree with the old permission lists in legacy-v1.ts.
// Rules: read-only. Rule 5 compares the "/// @app <id>" tags with each manifest's `models`. Until every model is tagged
// (P1-OPS-2) it compares only the tagged ones and warns about the rest. To make it strict once P1-OPS-2 is merged, set
// SCHEMA_TAGS_COMPLETE below to true (or run the script with --strict-tags): an untagged model is then an error.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { generate, outOfDate } from "./lib/generate.mjs";
import { ROOT, SCHEMA_FILE, matchPattern, scopeOf, stripScope } from "./lib/manifests.mjs";

const SCHEMA_TAGS_COMPLETE = true;   // P1-OPS-2 tagged all 91 models (10 Nov 2026)
const STRICT_TAGS = SCHEMA_TAGS_COMPLETE || process.argv.includes("--strict-tags");
const VERBOSE = process.argv.includes("--verbose");
// Models with a branchId column that deliberately are NOT branch work: EventOutbox.branchId is only a label (MODEL-OWNERS.md).
// Models whose branchId is a label or a link, not branch work: they never block deleting a branch.
// MembershipBranch / InviteBranch are who-works-where links; deleting the branch deletes them (P1-DB-2).
const BRANCH_LABEL_ONLY = new Set(["EventOutbox", "MembershipBranch", "InviteBranch", "ApprovalRequest"]);

const errors = [];
const warnings = [];
const err = (rule, msg) => errors.push(`rule ${rule}: ${msg}`);
const warn = (rule, msg) => warnings.push(`rule ${rule}: ${msg}`);

// ── Schema: models, their /// @app tag, and whether they have a branchId ──
function readSchema() {
  const file = path.join(ROOT, SCHEMA_FILE);
  if (!existsSync(file)) return null;
  const models = new Map();
  let docs = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\s*\/\/\//.test(line)) { docs.push(line); continue; }
    const m = /^model\s+(\w+)\s*\{/.exec(line);
    if (m) {
      models.set(m[1], { tag: null, branch: false });
      const t = docs.map((d) => /\/\/\/\s*@app\s+(\w+)/.exec(d)).find(Boolean);
      if (t) models.get(m[1]).tag = t[1];
      current = m[1];
    } else if (current && /^\s+branchId\s/.test(line)) models.get(current).branch = true;
    else if (/^\}/.test(line)) current = null;
    if (!/^\s*\/\/\//.test(line)) docs = [];
  }
  return models;
}
let current = null;

const { files, model, inputs } = await generate();
const all = model.sorted;                              // [{ file, manifest, text }]
const ids = new Set(all.map((m) => m.manifest.id));
const byId = new Map(all.map((m) => [m.manifest.id, m.manifest]));
const published = new Set(all.flatMap((m) => m.manifest.events.publishes.map((e) => e.name)));
for (const p of model.problems) err("generator", p);

for (const { file, manifest: m, text } of all) {
  const here = new Set(m.permissions.map((p) => p.id));
  const core = byId.get("workspace");
  const declared = (id) => here.has(id) || (core && core.permissions.some((p) => p.id === id));
  const where = `${file}`;

  // 1. folder name = id; permission and event names start with <id>. and have exactly three parts
  const folder = m.kind === "platform" ? "platform" : path.basename(path.dirname(file));
  if (m.manifestVersion !== 1) err(1, `${where}: manifestVersion must be 1`);
  if (folder !== m.id) err(1, `${where}: folder "${folder}" and id "${m.id}" differ`);
  if (!/^[a-z][a-z0-9_]*$/.test(m.id)) err(1, `${where}: id "${m.id}" must be lower-case letters, digits, underscore`);
  const threeParts = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
  for (const p of m.permissions) if (!p.id.startsWith(`${m.id}.`) || !threeParts.test(p.id)) err(1, `${where}: permission "${p.id}" must be ${m.id}.<resource>.<action>`);
  for (const e of m.events.publishes) if (!e.name.startsWith(`${m.id}.`) || !threeParts.test(e.name)) err(1, `${where}: event "${e.name}" must be ${m.id}.<resource>.<verb>`);

  // 2. everything that points at a permission points at a declared one (this app or workspace); patterns only in roles
  const point = (name, from) => {
    if (name.includes("*")) return err(2, `${where}: ${from} "${name}" uses a pattern; patterns are only allowed in roles`);
    if (!declared(name)) err(2, `${where}: ${from} "${name}" is not declared in ${m.id} or workspace`);
  };
  for (const r of m.roles) {
    for (const add of r.add) {
      if (add === "*" || add.includes("*")) continue;       // patterns are expanded by the generator, which reports a pattern that matches nothing
      point(stripScope(add), `role ${r.key} grant`);
      // 3. the scope suffix is one the permission allows
      const s = scopeOf(add);
      const decl = m.permissions.find((p) => p.id === stripScope(add)) ?? core?.permissions.find((p) => p.id === stripScope(add));
      if (s && decl && !decl.scopes.includes(s)) err(3, `${where}: role ${r.key} grants ${add}, but ${decl.id} allows only [${decl.scopes.join(", ")}]`);
    }
  }
  for (const item of m.menu) {
    if (item.permission) point(item.permission, `menu "${item.id}" permission`);
    for (const p of item.anyPermission ?? []) point(p, `menu "${item.id}" anyPermission`);
  }
  for (const a of m.approvals) { point(a.action, "approval action"); point(a.approverPermission, "approval approverPermission"); }
  for (const f of m.ai) point(f.permission, `ai "${f.id}" permission`);
  for (const p of m.permissions) if (p.default !== null && !p.scopes.includes(p.default)) err(3, `${where}: ${p.id} default "${p.default}" is not one of its scopes`);

  // 4. consumes are published somewhere; requires/optional name real apps
  for (const c of m.events.consumes) if (!published.has(c.name)) err(4, `${where}: consumes "${c.name}", which no manifest publishes`);
  for (const r of m.dependencies.requires) if (!ids.has(r)) err(4, `${where}: requires "${r}", which is not an app`);
  for (const r of m.dependencies.optional) if (!ids.has(r)) err(4, `${where}: optional "${r}", which is not an app`);

  // 6. Nepali texts (warning in Phase 1)
  let missing = 0;
  const need = (t) => { if (t && typeof t === "object" && "en" in t && !t.ne) missing += 1; };
  need(m.name); need(m.tagline); m.permissions.forEach((p) => need(p.label)); m.menu.forEach((i) => need(i.label)); m.ai.forEach((a) => { need(a.name); need(a.description); });
  m.limits.forEach((l) => need(l.label)); m.settings.forEach((s) => need(s.label)); m.approvals.forEach((a) => need(a.label)); m.branchOwned.forEach((b) => need(b.label));
  if (missing) warn(6, `${where}: ${missing} text(s) have no Nepali (ne) yet`);

  // 8. a manifest imports only types
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*\/\//.test(line)) return;
    if (/^\s*(import|export)\b[^;]*\bfrom\b/.test(line) && !/^\s*import\s+type\b/.test(line)) err(8, `${where}:${i + 1}: only "import type" is allowed in a manifest`);
    if (/^\s*import\s*["']/.test(line) || /\b(require|import)\s*\(/.test(line)) err(8, `${where}:${i + 1}: a manifest must not import or require anything at run time`);
  });

  // extra: kind app has a free edition; every limit used by an edition is declared
  if (m.kind === "app" && !m.editions.some((e) => e.free)) err("extra", `${where}: an app needs a free edition (the free-forever tier)`);
  const limitKeys = new Set(m.limits.map((l) => l.key));
  for (const e of m.editions) for (const k of Object.keys(e.limits)) if (!limitKeys.has(k)) err("extra", `${where}: edition "${e.id}" has limit "${k}", which is not declared in limits`);
  const menuIds = m.menu.map((i) => i.id);
  if (new Set(menuIds).size !== menuIds.length) err("extra", `${where}: menu ids are not unique`);
}

// 4 (cont). requires has no cycle
{
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 1) return err(4, `requires cycle: ${[...trail, id].join(" -> ")}`);
    if (state.get(id) === 2 || !byId.has(id)) return;
    state.set(id, 1);
    for (const r of byId.get(id).dependencies.requires) visit(r, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of ids) visit(id, []);
}

// 5. models: manifests against the schema
{
  const schema = readSchema();
  if (!schema) warn(5, `${SCHEMA_FILE} not found, schema ownership not checked`);
  else {
    const owner = new Map();
    for (const { manifest: m } of all) {
      for (const name of m.models) {
        if (owner.has(name)) err(5, `model ${name} is listed by both ${owner.get(name)} and ${m.id}`);
        owner.set(name, m.id);
        if (!schema.has(name)) err(5, `${m.id} lists model ${name}, which is not in schema.prisma`);
      }
      for (const b of m.branchOwned) if (!m.models.includes(b.model)) err(5, `${m.id}: branchOwned ${b.model} is not in its models`);
      for (const r of m.dependencies.reads) if (!schema.has(r)) err(5, `${m.id}: dependencies.reads "${r}" is not a model in schema.prisma`);
    }
    let untagged = 0;
    for (const [name, info] of schema) {
      if (!owner.has(name)) err(5, `model ${name} is in schema.prisma but in no manifest's models`);
      if (info.tag === null) { untagged += 1; if (STRICT_TAGS) err(5, `model ${name} has no "/// @app <id>" tag`); continue; }
      if (!ids.has(info.tag)) err(5, `model ${name} is tagged "/// @app ${info.tag}", which is not an app`);
      else if (owner.get(name) && owner.get(name) !== info.tag) err(5, `model ${name} is tagged @app ${info.tag} but ${owner.get(name)}'s manifest lists it`);
      if (info.branch && !BRANCH_LABEL_ONLY.has(name)) {
        const mine = byId.get(owner.get(name));
        if (mine && !mine.branchOwned.some((b) => b.model === name)) err(5, `model ${name} has a branchId field but is not in ${mine.id}'s branchOwned`);
      }
    }
    // models with a branchId that carry no tag yet are still checked against the manifest that lists them
    for (const [name, info] of schema) {
      if (info.tag !== null || !info.branch || BRANCH_LABEL_ONLY.has(name) || !owner.has(name)) continue;
      if (!byId.get(owner.get(name)).branchOwned.some((b) => b.model === name)) err(5, `model ${name} has a branchId field but is not in ${owner.get(name)}'s branchOwned`);
    }
    if (untagged && !STRICT_TAGS) warn(5, `${untagged} of ${schema.size} models have no "/// @app" tag yet (P1-OPS-2); only the ${schema.size - untagged} tagged ones were compared with the manifests`);
  }
}

// 7. generated files are current
{
  const stale = outOfDate(files);
  if (stale.length) err(7, `generated file(s) out of date: ${stale.join(", ")} (run npm run gen:permissions)`);
}

// ── extra: the manifests agree with today's lists (legacy-v1.ts) ──
{
  const L = inputs.legacy;
  const defs = Object.keys(inputs.businessTypeDefs);
  const known = (id) => model.byId.has(id);
  const aliasChecks = (map, groups, label) => {
    const olds = new Set(groups.flatMap((g) => g.perms));
    for (const o of olds) if (!map[o]) err("extra", `${label}: old permission "${o}" has no alias`);
    for (const o of Object.keys(map)) if (!olds.has(o)) err("extra", `${label}: alias "${o}" is not an old permission`);
    for (const [o, news] of Object.entries(map)) {
      if (new Set(news).size !== news.length) err("extra", `${label}: alias "${o}" repeats a name`);
      for (const n of news) if (!known(n)) err("extra", `${label}: alias "${o}" -> "${n}", which is not declared in any manifest`);
    }
  };
  aliasChecks(L.LEGACY_ALIASES, L.LEGACY_BUSINESS_GROUPS, "business aliases");
  aliasChecks(L.LEGACY_PLATFORM_ALIASES, L.LEGACY_PLATFORM_GROUPS, "staff aliases");

  // every business permission is reachable from an old name; staff may have new-only ones
  const reach = new Set(Object.values(L.LEGACY_ALIASES).flat());
  const reachStaff = new Set(Object.values(L.LEGACY_PLATFORM_ALIASES).flat());
  for (const c of model.catalog) {
    if (c.app === "platform" ? !reachStaff.has(c.id) : !reach.has(c.id)) {
      if (c.app !== "platform") err("extra", `permission ${c.id} is not the target of any old permission (add it to the alias map or remove it)`);
    }
  }

  // each old group's business types = the types the new permissions are available to
  for (const g of L.LEGACY_BUSINESS_GROUPS) {
    const want = g.types === "all" ? defs : g.types;
    for (const o of g.perms) {
      for (const n of L.LEGACY_ALIASES[o] ?? []) {
        const c = model.byId.get(n);
        if (!c) continue;
        const has = c.types === "all" ? defs : c.types;
        if (has.slice().sort().join() !== want.slice().sort().join()) err("extra", `${n} is offered to [${has}] but the old "${o}" is for [${want}]`);
      }
    }
  }

  // role equivalence: old templates, translated, give the same abilities as the manifests' roles
  const expandOld = (olds, map) => new Set(olds.flatMap((o) => map[o] ?? []));
  const names = (grants) => new Set(grants.filter((g) => g !== "*").map(stripScope));
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  for (const type of defs) {
    const typeGroups = L.LEGACY_BUSINESS_GROUPS.filter((g) => g.types === "all" || g.types.includes(type));
    const everyOld = typeGroups.flatMap((g) => g.perms);
    const oldRoles = L.LEGACY_TEMPLATES[type].map(([key, perms]) => ({ key, perms: perms ?? everyOld.filter((p) => p !== "roles.manage" && p !== "billing.manage") }));
    const newRoles = model.roleTemplates[type];
    if (oldRoles.map((r) => r.key).join() !== newRoles.map((r) => r.key).join()) err("extra", `roles of ${type}: old [${oldRoles.map((r) => r.key)}] vs manifests [${newRoles.map((r) => r.key)}]`);
    for (const o of oldRoles) {
      const n = newRoles.find((r) => r.key === o.key);
      if (!n) continue;
      if (o.perms[0] === "*") { if (!n.grants.includes("*")) err("extra", `${type}/${o.key}: owner must hold "*"`); continue; }
      const want = expandOld(o.perms, L.LEGACY_ALIASES);
      const got = names(n.grants);
      if (!sameSet(want, got)) {
        const lost = [...want].filter((x) => !got.has(x)), gained = [...got].filter((x) => !want.has(x));
        err("extra", `${type}/${o.key}: manifests and old template differ${lost.length ? `; missing ${lost.join(", ")}` : ""}${gained.length ? `; extra ${gained.join(", ")}` : ""}`);
      }
      for (const g of n.grants) {
        const c = model.byId.get(stripScope(g));
        if (c && c.default && scopeOf(g) !== c.default) err("extra", `${type}/${o.key}: ${g} is not at its default scope ${c.default}`);
      }
    }
  }
  for (const [key, olds] of Object.entries(L.LEGACY_PLATFORM_ROLES)) {
    const n = model.platformRoles.find((r) => r.key === key);
    if (!n) { err("extra", `staff role ${key} is not in the platform manifest`); continue; }
    if (olds[0] === "*") { if (!n.grants.includes("*")) err("extra", `staff ${key} must hold "*"`); continue; }
    const want = expandOld(olds, L.LEGACY_PLATFORM_ALIASES);
    const got = names(n.grants);
    const lost = [...want].filter((x) => !got.has(x));
    const extra = [...got].filter((x) => !want.has(x) && reachStaff.has(x));        // anything extra must be a new-only permission
    if (lost.length || extra.length) err("extra", `staff ${key}: manifest differs from the old role${lost.length ? `; missing ${lost.join(", ")}` : ""}${extra.length ? `; extra ${extra.join(", ")}` : ""}`);
  }
  if (model.platformRoles.map((r) => r.key).join() !== Object.keys(L.LEGACY_PLATFORM_ROLES).join()) err("extra", "staff roles differ from the old ones");
  void matchPattern;
}

if (warnings.length) {
  const shown = VERBOSE ? warnings : warnings.slice(0, 6);
  console.warn(`check-manifests: ${warnings.length} warning(s):\n  ${shown.join("\n  ")}${shown.length < warnings.length ? `\n  ... ${warnings.length - shown.length} more (use --verbose)` : ""}`);
}
if (errors.length) {
  console.error(`check-manifests: ${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-manifests: ok (${all.length} manifests, ${model.catalog.length} permissions).`);
