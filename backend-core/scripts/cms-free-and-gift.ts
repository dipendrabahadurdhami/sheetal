// cms-free-and-gift: the first step of the Sheetal Technology plan (27 Nov 2026, the owner's decision).
//   1. Listings are free for every business: the Listings app's editions get no listing limit (the live catalog, the same value
//      Admin -> Pricing edits; a reason and an audit row are kept).
//   2. One business gets every paid app at its top edition for a year, plus unlimited team seats (Sheetal Property, the pilot).
//   3. Listings that the old limit paused come back on the website at once (the hourly job would do it within the hour too).
// From backend-core (or the repo root with -w @sheetal/backend-core):
//     npx tsx scripts/cms-free-and-gift.ts --business=ID              (says what would change; writes nothing)
//     npx tsx scripts/cms-free-and-gift.ts --business=ID --apply      (writes; take a database backup first)
// Safe to run again: a gift that already lasts a year is not doubled, and an unlimited limit stays unlimited.
// DATABASE_URL comes from the shell, else backend-core/.env. It ends with PASS or FAIL.
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { SettingsService } from "@sheetal/platform/settings/service";
import { CATALOG_SETTING, withNewApps } from "@sheetal/platform/billing/catalog";
import { reconcileListingLimit } from "../src/domain/listing-limit.js";

const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes("--apply");
const quiet = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return quiet; }, level: "silent", silent() {} } as never;
const REASON = "Owner decision 27 Nov 2026: website listings (CMS) are free for every business; Sheetal Property gets every app free for one year.";

loadEnvFiles();
const db = new PrismaClient({ datasources: { db: { url: loadConfig(process.env, "website").DATABASE_URL } } });

async function main(): Promise<number> {
  const id = value("business");
  if (!id) { console.error("Say which business gets the year: --business=ID"); return 1; }
  const t = await db.tenant.findUnique({ where: { id }, select: { id: true, name: true, billingMode: true } });
  if (!t) { console.error(`No business with id ${id}.`); return 1; }
  const boss = await db.user.findFirst({ where: { platformRole: "super_admin" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!boss) { console.error("No super admin found to sign the change."); return 1; }
  const now = new Date();
  const until = new Date(now); until.setFullYear(until.getFullYear() + 1);
  console.log(apply ? "APPLYING" : "DRY RUN (nothing is written; add --apply to write)");

  // 1. Listings free for everyone.
  const store = new SettingsService(db as never, quiet);
  const cat = withNewApps(await store.get(CATALOG_SETTING));
  const listings = cat.apps.listings;
  if (!listings) { console.error("The catalog has no Listings app."); return 1; }
  const changes: string[] = [];
  for (const [edId, ed] of Object.entries(listings.editions)) {
    for (const key of ["listings", "stays"]) {
      const lim = ed.limits[key];
      if (lim && lim.value !== null) { changes.push(`Listings ${edId}: ${key} ${lim.value} -> unlimited`); lim.value = null; }
    }
  }
  console.log(`1. Listings free for every business: ${changes.length ? changes.join("; ") : "already unlimited"}`);
  if (apply && changes.length) await store.set(CATALOG_SETTING, cat, { actorId: boss.id, reason: REASON });

  // 2. A year of every paid app at its top edition, and unlimited seats.
  const paidApps = Object.entries(cat.apps)
    .map(([appId, a]) => {
      const paid = Object.entries(a.editions).filter(([, e]) => !e.free).sort((x, y) => y[1].priceMonthPaisa - x[1].priceMonthPaisa);
      return paid.length ? { appId, edition: paid[0]![0], name: a.name?.en ?? appId } : null;
    })
    .filter((x): x is { appId: string; edition: string; name: string } => !!x);
  // A gift that already runs for about a year (or for ever) counts, so a second run never doubles it.
  const nearlyAYear = new Date(now.getTime() + 350 * 864e5);
  const grants = await db.entitlementGrant.findMany({ where: { tenantId: t.id, revokedAt: null, OR: [{ endsAt: null }, { endsAt: { gte: nearlyAYear } }] } });
  const has = (kind: string, appId: string | null) => grants.some((g) => g.kind === kind && g.appId === appId);
  const toGive = paidApps.filter((a) => !has("app", a.appId));
  console.log(`2. ${t.name} (${t.billingMode}): every app free until ${until.toISOString().slice(0, 10)}`);
  console.log(`   apps to give (${toGive.length}): ${toGive.map((a) => `${a.name} [${a.edition}]`).join(", ") || "none (already given)"}`);
  console.log(`   unlimited team seats: ${has("seats", null) ? "already given" : "to give"}`);
  if (apply) {
    await db.$transaction(async (tx) => {
      for (const a of toGive) await tx.entitlementGrant.create({ data: { tenantId: t.id, kind: "app", appId: a.appId, key: a.edition, value: null, source: "staff", reason: REASON, endsAt: until, createdBy: boss.id } });
      if (!has("seats", null)) await tx.entitlementGrant.create({ data: { tenantId: t.id, kind: "seats", appId: null, key: null, value: null, source: "staff", reason: REASON, endsAt: until, createdBy: boss.id } });
      await tx.auditLog.create({ data: { actorId: boss.id, tenantId: t.id, action: "billing.grant_given", target: `every app (${toGive.length}) and unlimited seats until ${until.toISOString().slice(0, 10)}`, meta: { reason: REASON } } });
    });
  }

  // 3. Paused listings back on the website, for every business on apps.
  const tenants = await db.tenant.findMany({ where: { billingMode: "apps" }, select: { id: true, name: true } });
  let back = 0;
  for (const x of tenants) {
    const marked = await db.listing.count({ where: { tenantId: x.id, deletedAt: null, status: "paused", limitPausedAt: { not: null } } });
    if (!marked) continue;
    if (apply) {
      const r = await reconcileListingLimit(db as never, x.id, { now });
      back += r?.restored ?? 0;
      console.log(`3. ${x.name}: ${r?.restored ?? 0} listings back on the website (still paused ${r?.stillPaused ?? 0})`);
    } else {
      back += marked;
      console.log(`3. ${x.name}: ${marked} paused listings would come back on the website`);
    }
  }
  if (!back) console.log("3. No paused listings to bring back.");
  console.log(`PASS (${apply ? "written" : "dry run"})`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error(e); console.log("FAIL"); process.exitCode = 1; })
  .finally(() => db.$disconnect());
