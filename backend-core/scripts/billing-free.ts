// billing-free: moves a business to the free tier now, and brings website listings in line with the Listings limit.
// Rules and what exactly changes: src/domain/billing-free.ts and src/domain/listing-limit.ts. From the repo root:
//     npm run billing:free -- --business=ID[,ID]            (says what would change; writes nothing)
//     npm run billing:free -- --business=ID[,ID] --apply    (writes; one transaction per business; take a backup first)
//     npm run billing:free -- --listings                    (only the listing rule, for every business on apps; add --apply to write)
//     add --force to end apps a business really paid for while their period still runs
// What "free" means: every app goes to its free edition (an app without one ends), the old plan becomes Starter, and only as many
// published listings as the free edition allows stay on the website. The others are paused, not deleted, and come back by themselves when
// the business pays for Listings again. Listings that were not on the website before are never shown by this.
// DATABASE_URL comes from the shell, else backend-core/.env. Names are masked. It ends with PASS or FAIL (exit code 0 or 1).
// Run it with the API servers stopped, then start them again.
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { maskName } from "@sheetal/platform/billing/migrate-plan";
import { moveToFree } from "../src/domain/billing-free.js";
import { listingLimitOf, reconcileListingLimit } from "../src/domain/listing-limit.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

loadEnvFiles();
const db = new PrismaClient({ datasources: { db: { url: loadConfig(process.env, "website").DATABASE_URL } } });

async function main(): Promise<number> {
  const apply = flag("apply");
  if (flag("listings")) {
    const tenants = await db.tenant.findMany({ where: { billingMode: "apps" }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    console.log(apply ? "LISTING LIMITS" : "DRY RUN of the listing limits (nothing is written; add --apply to write)");
    for (const t of tenants) {
      if (apply) {
        const r = await reconcileListingLimit(db as never, t.id);
        if (r) console.log(`${maskName(t.name, t.id)}: limit ${r.limit ?? "unlimited"}; ${r.published} on the website; paused ${r.paused}, shown again ${r.restored}, still paused ${r.stillPaused}`);
      } else {
        const now = new Date();
        const [limit, published, marked] = await Promise.all([
          listingLimitOf(db as never, t.id, now),
          db.listing.count({ where: { tenantId: t.id, deletedAt: null, status: "published" } }),
          db.listing.count({ where: { tenantId: t.id, deletedAt: null, status: "paused", limitPausedAt: { not: null } } }),
        ]);
        const pause = limit === null ? 0 : Math.max(0, published - limit);
        const back = limit === null ? marked : Math.max(0, Math.min(marked, limit - published));
        console.log(`${maskName(t.name, t.id)}: limit ${limit ?? "unlimited"}; ${published} on the website; would pause ${pause}, would show again ${back}`);
      }
    }
    console.log(`${tenants.length} businesses on apps. PASS`);
    return 0;
  }
  const only = value("business")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!only?.length) { console.error("Say which businesses: --business=ID[,ID]   (or --listings for the listing rule alone)"); return 1; }
  console.log(apply ? "MOVE TO THE FREE TIER" : "DRY RUN (nothing is written; add --apply to write)");
  let refused = 0;
  for (const id of only) {
    const r = await moveToFree(db as never, { tenantId: id, apply, force: flag("force") });
    if (!r.ok) { refused++; console.log(`REFUSED ${r.masked}: ${r.reason}`); continue; }
    if (r.reason) { console.log(`SAME    ${r.masked}: ${r.reason}`); continue; }
    console.log(`${apply ? "MOVED  " : "WOULD  "} ${r.masked}: plan ${r.planBefore} -> ${r.planAfter}`);
    console.log(`        to the free edition: ${r.toFree.join(", ") || "-"}`);
    console.log(`        ended (no free edition): ${r.ended.join(", ") || "-"}`);
    console.log(`        ${r.grantsRevoked} old-plan grant(s) revoked, ${r.addonsEnded} add-on(s) ended, price lock ${r.lockRemoved ? "removed" : "none"}`);
    console.log(`        listings: ${r.published} on the website, the free edition allows ${r.listingLimit ?? "unlimited"}: ${r.listingsPaused} ${apply ? "paused" : "would be paused"} (not deleted; they come back when the business pays for Listings)`);
  }
  console.log(`${only.length} businesses, ${refused} refused. ${refused ? "FAIL" : "PASS"}`);
  return refused ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
