// `npm run reviews:sample`: adds sample website reviews to one business so Business → Reviews (reply, edit, remove, filters) can be
// tested by hand. Never on the live site. Safe to run again: each sample reviewer writes at most one review per business or listing.
// Usage: npm run reviews:sample -- [--owner <email>]   (default: owner.agency.business@sheetal.test, made by accounts:test)
// How it works: makes up to four website users (reviewer1..4@sheetal.test, no password: they cannot sign in) and writes their reviews:
// three about the business (5, 2 and 1 stars, one already answered) and one about the business's first listing, if it has one.
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";

loadEnvFiles();
const config = loadConfig(process.env, "website");
if (process.env.NODE_ENV === "production") { console.error("This adds sample reviews. It doesn't run with NODE_ENV=production."); process.exit(1); }
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const ownerEmail = arg("--owner") || "owner.agency.business@sheetal.test";
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });

const SAMPLES = [
  { n: 1, name: "Sita Karki", rating: 5, comment: "Quick and honest agents. They found us a flat in a week.", reply: "Thank you, Sita! Enjoy the new home." },
  { n: 2, name: "Ram Bhandari", rating: 2, comment: "The flat was not as clean as the photos showed." },
  { n: 3, name: "Gita Thapa", rating: 1, comment: "Nobody called me back after the visit." },
];

try {
  const owner = await db.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) throw new Error(`No user ${ownerEmail}. Run npm run accounts:test first.`);
  const m = await db.membership.findFirst({ where: { userId: owner.id }, orderBy: { createdAt: "asc" } });
  if (!m) throw new Error(`${ownerEmail} is not in any business.`);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: m.tenantId } });
  const reviewer = (n: number, name: string) =>
    db.user.upsert({ where: { email: `reviewer${n}@sheetal.test` }, update: {}, create: { email: `reviewer${n}@sheetal.test`, userName: name, userType: "user", emailVerifiedAt: new Date() } });
  let added = 0;
  for (const s of SAMPLES) {
    const u = await reviewer(s.n, s.name);
    const has = await db.review.findFirst({ where: { userId: u.id, tenantId: tenant.id } });
    if (has) continue;
    await db.review.create({ data: { userId: u.id, tenantId: tenant.id, rating: s.rating, comment: s.comment, createdBy: u.id,
      ...(s.reply ? { reply: s.reply, repliedAt: new Date(), repliedBy: owner.id } : {}) } });
    added++;
  }
  const listing = await db.listing.findFirst({ where: { tenantId: tenant.id }, orderBy: { id: "asc" } });
  if (listing) {
    const u = await reviewer(4, "Hari Shrestha");
    if (!(await db.review.findFirst({ where: { userId: u.id, listingId: listing.id } }))) {
      await db.review.create({ data: { userId: u.id, listingId: listing.id, rating: 4, comment: "Good location, the owner was helpful.", createdBy: u.id } });
      added++;
    }
  }
  console.log(`${added} sample review(s) added to "${tenant.name}"${listing ? "" : " (it has no listing, so no listing review)"}. Open Business → Reviews.`);
} finally {
  await db.$disconnect();
}
