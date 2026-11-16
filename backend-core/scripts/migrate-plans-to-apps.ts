// migrate-plans-to-apps: moves businesses from Starter / Business / Pro to app subscriptions, with proof that nobody loses access or pays
// more (MARKETPLACE-AND-BILLING.md section 8; P3-BE-10). NOT a migration: a script you look at first (dry run), run (apply) and undo (restore).
// Where it fits: step 1 of the cutover (MB 8.6). After --apply the rows exist but every business stays on billingMode "plans", so nobody
// sees a change until staff move a business to "shadow" and then "apps" (OPS-1). The owner says yes before --apply on real data, with a
// backup first (npm run backup).
// How it works: TypeScript run with tsx (like the other backend-core scripts), so it calls the very code the servers use: the generated app
// registry, the catalog and billing settings, buildEntitlements (v1), buildEntitlementsV3, quote(). Nothing is copied by hand.
// DATABASE_URL comes from the shell, else backend-core/.env, else the root .env. From the repo root:
//     npm run billing:migrate                          (= --dry-run: prints per business what would be written; writes nothing)
//     npm run billing:migrate -- --apply               (writes, ONE transaction per business, all-or-nothing per business)
//     npm run billing:migrate -- --restore             (removes the last apply run's rows; refuses a business with a new-system sale; --force)
//     add --verbose (every row), --business=ID[,ID] (try one first), --csv=path (the price report), --catalog=path (a catalog JSON to test
//     prices against), --run=ID (restore a given run)
// The proofs P1 to P8 (see platform/src/billing/migrate-plan.ts and src/domain/billing-migration.ts) are printed per business. --apply
// refuses a business with any FAIL; the summary ends with PASS or FAIL (exit code 0 or 1), like check-branch-links.mjs. Business names are
// masked to 2 letters plus the id.
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { passed } from "@sheetal/platform/billing/migrate-plan";
import type { Catalog } from "@sheetal/platform/billing/types";
import { apply, dryRun, migrationEnv, priceReportCsv, restore, summary, type BusinessResult } from "../src/domain/billing-migration.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = value("business")?.split(",").map((s) => s.trim()).filter(Boolean);
const verbose = flag("verbose");

loadEnvFiles();
const config = loadConfig(process.env, "website");
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");
const rs = (p: number) => `Rs ${(p / 100).toFixed(2)}`;

function print(results: BusinessResult[]) {
  for (const r of results) {
    const p = r.plan;
    if (p.kind === "skip") { console.log(`SKIP  ${p.masked}: ${p.reason}`); continue; }
    const ok = passed(p) && !r.error;
    console.log(`${ok ? "PASS" : "FAIL"}  ${p.masked}: ${p.subscriptions.length} apps, ${p.grants.length} grants, lock until ${day(p.lockEnd)}${r.written ? " (written)" : ""}${r.error ? ` (${r.error})` : ""}`);
    for (const x of p.proofs) if (verbose || !x.ok) console.log(`      ${x.ok ? "ok  " : "FAIL"} ${x.id} ${x.detail}`);
    if (p.price) console.log(`      price: old ${rs(p.price.oldMonthlyPaisa * p.price.periodMonths)} per ${p.price.periodMonths} month(s); first renewal ${rs(p.price.protectedRenewalPaisa)}; after the lock ${rs(p.price.afterLockRenewalPaisa)}`);
    if (p.invoicesToVoid.length) console.log(`      open plan invoices to void when the business moves to "apps": ${p.invoicesToVoid.join(", ")}`);
    if (verbose) {
      for (const s of p.subscriptions) console.log(`      app ${s.appId} ${s.editionId} ${s.status}${s.periodMonths ? ` ${s.periodMonths} mo ${rs(s.priceGrossPaisa)} until ${day(s.currentPeriodEnd)}` : ""}${s.trialEndsAt ? ` trial until ${day(s.trialEndsAt)}` : ""}`);
      for (const g of p.grants) console.log(`      grant ${g.kind} ${g.appId ?? ""}${g.key ? `.${g.key}` : ""} = ${g.value ?? "unlimited"} until ${day(g.endsAt)}`);
      for (const a of p.addons) console.log(`      add-on record ${a.addonKey} × ${a.qty} at ${rs(a.unitPriceGrossPaisa)} a month`);
      if (p.lock) console.log(`      price lock ${rs(p.lock.legacyMonthlyGrossPaisa)} a month for ${p.lock.coversApps.join(", ")}`);
      for (const m of p.more) console.log(`      more: ${m.what} (${String(m.v1)} -> ${String(m.v3)})`);
    }
  }
}

async function main(): Promise<number> {
  if (flag("restore")) {
    const r = await restore(db, { runId: value("run"), only, force: flag("force") });
    if (!r.runId) { console.log("No apply run to restore."); return 0; }
    console.log(`Restore of run ${r.runId}: ${r.restored.length} restored, ${r.refused.length} refused.`);
    for (const x of r.refused) console.log(`REFUSED ${x.id}: ${x.reason}`);
    console.log(r.refused.length ? "FAIL" : "PASS");
    return r.refused.length ? 1 : 0;
  }
  const catalogFile = value("catalog");
  const env = await migrationEnv(db, { catalog: catalogFile ? (JSON.parse(readFileSync(catalogFile, "utf8")) as Catalog) : undefined });
  const res = flag("apply") ? await apply(db, env, { only }) : null;
  const results = res?.results ?? (await dryRun(db, env, only));
  console.log(flag("apply") ? `APPLY (run ${res!.runId})` : "DRY RUN (nothing is written; add --apply to write)");
  print(results);
  const csv = value("csv");
  // The first character (a byte-order mark) tells Excel the file is UTF-8, so the "…" in the masked names reads right.
  if (csv) { writeFileSync(csv, `﻿${priceReportCsv(results)}`); console.log(`Price report: ${csv}`); }
  const s = summary(results);
  const ok = res ? res.ok : s.failed.length === 0;
  console.log(`${s.planned} planned, ${s.passed} passed every proof, ${s.written} written, ${s.skipped.length} skipped, ${s.failed.length} failed. ${ok ? "PASS" : "FAIL"}`);
  return ok ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
