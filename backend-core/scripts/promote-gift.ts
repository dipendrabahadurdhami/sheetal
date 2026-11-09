// `npm run promote:gift`: listings that were featured on the old website get a free home-page boost for 30 days from
// today, so businesses keep their place after the move. The business can stop it, or move the days left to another of
// its listings, in Business → Promote. Listings of no business (Sheetal's own) stay featured as they were.
// Safe to run again: a listing that already has a gift boost is skipped. Run once after the Promote update.
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "../src/config.js";
import { GIFT_DAYS, addDays, today } from "../src/domain/promote.js";
import { dayOf } from "../src/domain/money.js";

loadEnvFiles();
const config = loadConfig(process.env, "website");
const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });

try {
  const start = today();
  const end = addDays(start, GIFT_DAYS - 1);
  const rows = await prisma.listing.findMany({ where: { featured: true, tenantId: { not: null }, status: "published" }, select: { id: true, code: true, tenantId: true } });
  let made = 0;
  for (const l of rows) {
    const has = await prisma.boost.findFirst({ where: { listingId: l.id, source: "gift" }, select: { id: true } });
    if (has) continue;
    await prisma.$transaction([
      prisma.boost.create({ data: { tenantId: l.tenantId!, listingId: l.id, place: "home", days: GIFT_DAYS, startOn: dayOf(start), endOn: dayOf(end), source: "gift", status: "paid", paidAt: new Date() } }),
      // The gift takes the place of the old "featured" mark, so it doesn't use one of the plan's free slots too.
      prisma.listing.update({ where: { id: l.id }, data: { featured: false } }),
    ]);
    made++;
  }
  console.log(made ? `Gave ${made} listing${made > 1 ? "s" : ""} a free home-page boost until ${end}.` : "Nothing to do: no featured business listings without a gift boost.");
} finally {
  await prisma.$disconnect();
}
