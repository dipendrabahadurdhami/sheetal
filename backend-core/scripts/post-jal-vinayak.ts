// Posts Sheetal's Jal Vinayak Colony on the website from the owner's price list and floor plans (27 Nov 2026): a project with the 11
// houses for sale (price, land, built-up area, facing, furnished) and a land listing with the 12 plots (rate per aana and the total).
// Run:   npx tsx scripts/post-jal-vinayak.ts --dir=<photos folder> [--tenant=<id>] [--apply] [--photos]
// Photos: files named site-*.jpg go on both listings, plan-*.jpg (floor plans) on the houses only; sorted by name. --photos replaces the
// photos of posts already there (for the full-size photos later). Without --apply it only says what it would do.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { listingCode, prefixFor } from "../src/domain/codes.js";
import { savePhoto } from "../src/lib/photos.js";

loadEnvFiles();
const config = loadConfig(process.env, "website");
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const apply = args.includes("--apply");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const cr = (rs: number) => `Rs. ${+(rs / 1e7).toFixed(2)} Cr`;
const lakh = (rs: number) => (rs >= 1e7 ? cr(rs) : `Rs. ${+(rs / 1e5).toFixed(2)} lakh`);
const PLACE = { area: "Jal Vinayak, Chobhar", city: "Kirtipur", district: "Kathmandu" };

// The price list: houses (no., land in aana, built-up sq ft, price, facing, furnished) and plots (no., aana, lakh per aana).
const HOUSES: [string, number, number, number, string, boolean][] = [
  ["23", 3.891, 2031.9, 2.6e7, "East", false], ["69", 7.901, 2880.53, 4.6e7, "South-East", true], ["70", 4.741, 2262.92, 3.1e7, "South-East", false],
  ["72", 4.5136, 2262.92, 3.0e7, "South-East", false], ["74", 4.5636, 2262.92, 3.0e7, "South-East", false], ["75", 4.5265, 2262.92, 3.0e7, "South-East", false],
  ["76", 4.5574, 2262.92, 3.0e7, "South-East", false], ["77", 4.7499, 2262.92, 3.1e7, "South-East", false], ["79", 5.365, 2570.12, 3.6e7, "South-East", true],
  ["80", 5.826, 2570.12, 3.75e7, "South-East", true], ["34", 5.96, 2083.6, 3.7e7, "East", true],
];
const PLOTS: [string, number, number][] = [
  ["29", 10.718, 35], ["35", 6.044, 35], ["36", 5.233, 33], ["38", 5.346, 33], ["56", 5.58, 33], ["65", 7.253, 31],
  ["66", 6.925, 31], ["67", 11.586, 28], ["78", 5.8559, 28], ["81", 7.239, 28], ["82", 8.649, 28], ["84", 31.669, 32],
];
const plotTotal = (aana: number, rateLakh: number) => Math.round(aana * rateLakh * 1e5);

// The house plans the owner sent (the 2,262.92 sq ft type): basement, first and second floor, roof.
const PLAN: [string, string][] = [
  ["Basement (401.2 sq ft)", "Kitchen 10'0\" × 10'7\", dining 11'2\" × 10'7\", store room"],
  ["First floor (702.19 sq ft)", "Master bedroom 17'8\" × 14'9\" and queen room 11'8\" × 11'0\", family room, 2 attached bathrooms, 2 balconies"],
  ["Second floor (461.01 sq ft)", "Children's room 12'4\" × 12'7\" with attached bathroom, pooja room, laundry, terraces and a balcony"],
  ["Roof", "Open terrace"],
];

async function main() {
  const dir = arg("dir");
  if (!dir || !existsSync(dir)) throw new Error("Give --dir=<folder with site-*.jpg and plan-*.jpg>.");
  const files = readdirSync(dir).sort();
  const site = files.filter((f) => f.startsWith("site-")), plans = files.filter((f) => f.startsWith("plan-"));
  const tenant = arg("tenant")
    ? await db.tenant.findUniqueOrThrow({ where: { id: arg("tenant")! } })
    : await db.tenant.findFirstOrThrow({ where: { name: { equals: "Sheetal Property", mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
  const head = await db.branch.findFirstOrThrow({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } });
  const owner = await db.membership.findFirst({ where: { tenantId: tenant.id, status: "active", role: { key: "owner" } }, select: { userId: true } });
  const minHouse = Math.min(...HOUSES.map((h) => h[3]));
  const plotPrices = PLOTS.map(([, a, r]) => plotTotal(a, r));

  const LISTINGS = [
    {
      kind: "project", category: "Project", propertyType: "Colony", photos: [...site, ...plans],
      title: "Jal Vinayak Colony: ready houses in a gated colony, Chobhar, Kirtipur",
      price: minHouse, facilities: ["Gated colony", "Entrance gate", "Paved internal roads", "Terrace", "Balcony", "Pooja room", "Laundry area", "Store room"],
      description: `<p><b>Jal Vinayak Colony</b> is a gated residential colony in Chobhar, Kirtipur, on the south side of Kathmandu, with rows of
modern brick-and-white houses, paved internal roads and an entrance gate. <b>11 houses are for sale</b>, from ${cr(minHouse)}.</p>
<p>Houses stand on 3.9 to 7.9 aana with 2,032 to 2,881 sq ft built, mostly facing south-east; some come furnished. The common
2,262.92 sq ft house has a basement kitchen, dining and store, a first floor with the master bedroom, queen room, family room and two
attached bathrooms, a second floor with the children's room, pooja room and laundry, and terraces with a view of the hills.</p>
<p>The colony also has <b>12 plots</b> for building your own house (see the Jal Vinayak Colony plots listing). Call or send an enquiry to
visit.</p>`,
      units: HOUSES.map(([no, aana, built, price, face, furn]) => ({ type: `House ${no} · ${aana} aana · ${face} facing · ${furn ? "furnished" : "non-furnished"}`, size: built, count: 1, price })),
      more: [["Location", `${PLACE.area}, ${PLACE.city}, ${PLACE.district}`], ["Houses for sale", `${HOUSES.length}, from ${cr(minHouse)} to ${cr(Math.max(...HOUSES.map((h) => h[3])))}`],
        ["Plots for sale", `${PLOTS.length} (separate listing)`], ...PLAN] as [string, string][],
    },
    {
      kind: "sell", category: "Land", propertyType: "Residential plot", photos: site,
      title: "Jal Vinayak Colony: residential plots from 5.2 aana, Chobhar, Kirtipur",
      price: Math.min(...plotPrices), facilities: ["Gated colony", "Entrance gate", "Paved internal roads"],
      description: `<p><b>12 residential plots</b> in Jal Vinayak Colony, a gated colony in Chobhar, Kirtipur, Kathmandu, with paved internal
roads and finished houses around them. Plots are 5.2 to 31.7 aana, at Rs. 28 to 35 lakh per aana.</p>
<p>Build your own home among the colony's houses. Each plot's size, rate and total are listed below. Call or send an enquiry to visit.</p>`,
      more: [["Location", `${PLACE.area}, ${PLACE.city}, ${PLACE.district}`],
        ...PLOTS.map(([no, aana, rate]): [string, string] => [`Plot ${no}`, `${aana} aana · Rs. ${rate} lakh per aana · about ${lakh(plotTotal(aana, rate))}`])],
    },
  ];

  console.log(`Business: ${tenant.name}. ${apply ? "APPLYING" : "dry run"}. Photos: ${site.length} site, ${plans.length} plans.`);
  for (const L of LISTINGS) {
    const had = await db.listing.findFirst({ where: { tenantId: tenant.id, title: L.title, deletedAt: null }, select: { id: true, code: true } });
    if (had && !args.includes("--photos")) { console.log(`= ${had.code} already there: ${L.title}`); continue; }
    console.log(`${had ? "~ new photos for" : "+"} ${L.kind}: ${L.title} (${L.photos.length} photos, from ${lakh(L.price)})`);
    if (!apply) continue;
    const saved: string[] = [];
    for (const f of L.photos) saved.push(await savePhoto(config.MEDIA_DIR, readFileSync(join(dir, f))));
    if (had) {
      await db.$transaction([db.listingPhoto.deleteMany({ where: { listingId: had.id } }), db.listingPhoto.createMany({ data: saved.map((file, sort) => ({ listingId: had.id, file, sort })) })]);
      console.log(`  ${had.code}: photos replaced`);
      continue;
    }
    const now = new Date();
    const l = await db.listing.create({
      data: {
        code: `TMP-${Date.now()}`, slug: `tmp-${Date.now()}`, tenantId: tenant.id, branchId: head.id, userId: owner?.userId ?? null, createdBy: owner?.userId ?? null,
        kind: L.kind, purpose: "sale", category: L.category, propertyType: L.propertyType, title: L.title, description: L.description,
        status: "published", publishedAt: now, submittedAt: now, reviewedAt: now, price: BigInt(L.price), negotiable: true,
        province: "Bagmati", district: PLACE.district, city: PLACE.city, area: PLACE.area, facilities: L.facilities,
        details: { more: L.more, ...("units" in L ? { units: L.units } : {}) },
        photos: { create: saved.map((file, sort) => ({ file, sort })) },
      },
    });
    const code = listingCode(await prefixFor(db, tenant.id), l.id);
    await db.listing.update({ where: { id: l.id }, data: { code, slug: `${slugify(L.title)}-${l.id}` } });
    console.log(`  posted ${code}: /property/${slugify(L.title)}-${l.id}`);
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => db.$disconnect());
