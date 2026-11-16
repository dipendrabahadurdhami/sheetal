// check-catalog: checks that the marketplace catalog is safe to sell from (PHASE-3-RISKS.md A8; PHASE-3-TASKS.md, task P3-OPS-1).
// Where it fits: part of `npm run check` (script `check:catalog`), and step 3 of the Phase 3 dry run (scripts/ops/p3-step1.ps1), which adds
// --db to check the catalog that is SAVED in a database too (the one Admin -> Pricing edits).
// How it works: TypeScript run with tsx, so it reads the very code the servers use (the generated app registry, the seed prices, the guard
// catalogProblems). Without --db it needs no database:
//   1. the seed catalog (manifests + platform/src/billing/catalog.seed.ts) passes the schema and the guard;
//   2. the seed and the manifests agree: every seed price names a real app and edition, no "extra" seed app hides behind a manifest of the
//      same id, every soft limit and every add-on names a limit that exists, every paid edition of a live app has a price.
// With --db it also reads platform.catalog from DATABASE_URL (the shell's, else backend-core/.env) and runs the same schema and guard on it,
// with the apps a new release added filled in (withNewApps), exactly as the servers read it.
// Rules: read-only. Exit code 0 = all good, 1 = problems (each printed as one plain sentence).
// Run it: `npm run check:catalog`, or `npm run check:catalog -- --db`.
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import { CATALOG_SETTING, CatalogSchema, catalogProblems, seedCatalog, withNewApps } from "@sheetal/platform/billing/catalog";
import { SEED_ADDONS, SEED_EXTRA_APPS, SEED_PRICES, SOFT_LIMITS } from "@sheetal/platform/billing/catalog.seed";
import type { Catalog } from "@sheetal/platform/billing/types";

/** Schema and guard problems of one catalog, each starting with `label`. */
function problemsOf(label: string, cat: Catalog): string[] {
  const parsed = CatalogSchema.safeParse(cat);
  if (!parsed.success) return parsed.error.issues.map((i) => `${label}: ${i.path.join(".")}: ${i.message}`);
  return catalogProblems(cat).map((p) => `${label}: ${p}`);
}

/** Where the seed file and the app manifests disagree. */
export function seedProblems(): string[] {
  const out: string[] = [];
  const apps = APPS.filter((m) => m.kind === "app");
  const byId = new Map(apps.map((m) => [m.id, m]));
  for (const [id, editions] of Object.entries(SEED_PRICES)) {
    const m = byId.get(id);
    if (!m) { out.push(`seed: a price is set for "${id}", which is not an app manifest.`); continue; }
    for (const ed of Object.keys(editions)) {
      const e = m.editions.find((x) => x.id === ed);
      if (!e) out.push(`seed: a price is set for ${id} ${ed}, but the manifest has no such edition.`);
      else if (e.free) out.push(`seed: a price is set for ${id} ${ed}, which is a free edition.`);
    }
  }
  for (const m of apps) for (const e of m.editions) {
    if (!e.free && !SEED_PRICES[m.id]?.[e.id] && !e.price && (m.availability ?? "live") === "live") out.push(`seed: ${m.id} ${e.id} is a paid edition without a price.`);
  }
  for (const id of Object.keys(SEED_EXTRA_APPS)) if (byId.has(id)) out.push(`seed: "${id}" is listed as an app without code, but it has a manifest now (remove it from SEED_EXTRA_APPS).`);
  const seed = seedCatalog();
  const limitKeys = new Set(Object.values(seed.apps).flatMap((a) => Object.values(a.editions).flatMap((e) => Object.keys(e.limits))));
  for (const k of Object.keys(SOFT_LIMITS)) if (!limitKeys.has(k)) out.push(`seed: the soft limit "${k}" is not a limit of any app.`);
  for (const a of SEED_ADDONS) {
    const app = a.appId ? seed.apps[a.appId] : null;
    if (a.appId && !app) out.push(`seed: add-on ${a.key} names the app "${a.appId}", which is not in the catalog.`);
    if (app && !Object.values(app.editions).some((e) => a.limitKey in e.limits)) out.push(`seed: add-on ${a.key} raises "${a.limitKey}", which is not a limit of ${a.appId}.`);
  }
  return out;
}

async function main(): Promise<number> {
  const seed = seedCatalog();
  const problems = [...problemsOf("seed", seed), ...seedProblems()];
  let saved = "";
  if (process.argv.includes("--db")) {
    const { PrismaClient } = await import("@prisma/client");
    const { loadConfig, loadEnvFiles } = await import("@sheetal/platform/core/config");
    const { SettingsService } = await import("@sheetal/platform/settings/service");
    loadEnvFiles();
    const db = new PrismaClient({ datasources: { db: { url: loadConfig(process.env, "website").DATABASE_URL } } });
    try {
      const cat = withNewApps(await new SettingsService(db as never, { warn: () => undefined }).get(CATALOG_SETTING));
      problems.push(...problemsOf("saved catalog", cat));
      saved = `; the saved catalog (version ${cat.version}, ${Object.keys(cat.apps).length} apps) passes the same guard`;
    } finally {
      await db.$disconnect();
    }
  }
  if (problems.length) {
    console.error(`check-catalog: ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(`check-catalog: ${Object.keys(seed.apps).length} apps in the seed catalog, prices and limits agree with the manifests${saved}.`);
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((e) => { console.error(e); process.exitCode = 1; });
