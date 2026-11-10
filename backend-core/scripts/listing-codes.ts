// `npm run listings:codes`: gives every business that has no property code prefix its default one (the initials of
// its name, Everest Realty → ER) and changes the codes of all its listings to it (ER-0123). Old codes are kept, so
// they still find the listing. Listings posted by people without a business keep SP.
// Usage: npm run listings:codes -- [--dry-run]   (--dry-run only lists what would change)
// Safe to run again: a business that already has a prefix is left as it is.
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "../src/config.js";
import { initialsOf, recodeListings } from "../src/domain/codes.js";

loadEnvFiles();
const config = loadConfig(process.env, "website");
const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const dry = process.argv.includes("--dry-run");

try {
  const tenants = await prisma.tenant.findMany({ where: { codePrefix: null }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  let listings = 0;
  for (const t of tenants) {
    const prefix = initialsOf(t.name);
    if (dry) { console.log(`${t.name}: ${prefix} (${await prisma.listing.count({ where: { tenantId: t.id } })} listings)`); continue; }
    const n = await prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: t.id }, data: { codePrefix: prefix } });
      return recodeListings(tx, t.id, prefix);
    });
    listings += n;
    console.log(`${t.name}: ${prefix}, ${n} listing code${n === 1 ? "" : "s"} changed`);
  }
  console.log(dry ? `${tenants.length} businesses would get a prefix. Run again without --dry-run to do it.` : `Done: ${tenants.length} businesses, ${listings} listing codes changed.`);
} finally {
  await prisma.$disconnect();
}
