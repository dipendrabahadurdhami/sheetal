// Posts Sheetal Property's "Chitwan Tourism Hub" (Dibyanagar, Chitwan) on the website: an investment offering and a project of 2BHK
// pool villas, with the renders, the villa drawing sheets and the 97-plot site plan (the owner's files of 27 Nov 2026).
// Run:   npx tsx scripts/post-chitwan-hub.ts --dir=<folder of photos> [--tenant=<id>] [--apply]
// Without --apply it only says what it would do. Safe to run twice: a listing with the same title for the business is left alone.
// Prices are "on request" (the owner's choice): price stays empty, so the website shows "Price on request" and the enquiry form.

import { readFileSync, existsSync } from "node:fs";
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
const dir = arg("dir");

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const ul = (xs: string[]) => `<ul>${xs.map((x) => `<li>${x}</li>`).join("")}</ul>`;

const VILLA_FACTS: [string, string][] = [
  ["Villa", "2BHK luxury single-storey villa with private pool"],
  ["Built-up area", "1,236 sq ft"],
  ["Plot", "10 aana (3,422.5 sq ft)"],
  ["Bedrooms", "2, each with its own bathroom (master with en-suite)"],
  ["Living", "Open-plan living and dining on Italian marble, kitchen with island"],
  ["Private pool", "12'6\" × 22'9\", with pool loungers"],
  ["Deck", "Teak-texture deck, 156.7 sq ft"],
  ["Parking", "2 cars"],
  ["Roof", "Hipped, slate-tile style Decra roofing"],
  ["Flooring", "Granite and tile"],
  ["Garden", "Tropical landscaping, boundary wall and fence"],
];
const HUB_FACTS: [string, string][] = [
  ["Project", "Chitwan Tourism Hub (Project No. 2)"],
  ["Location", "Dibyanagar, Chitwan"],
  ["Layout", "97 plots on a planned site with internal roads, two open spaces and land for business use"],
  ["Plots", "Available, sold and booked plots are marked on the site plan in the photos"],
  ["Homes", "Private pool villas, starting with the 2BHK villa"],
];

const LISTINGS = [
  {
    kind: "invest", category: "Investment", propertyType: "Villa project",
    title: "Chitwan Tourism Hub: invest in a gated villa community in Dibyanagar",
    photos: ["22.jpg", "plot-map.png", "14.jpg", "12.jpg", "15.jpg", "villa-sheet-1.jpg", "11.jpg", "17.jpg", "18.jpg", "19.jpg", "10.jpg", "9.jpg", "villa-sheet-2.jpg"],
    facilities: ["Swimming pool", "Gated entrance", "Green space", "Internal roads", "Landscaping", "Land for business use"],
    description: `<p><b>Chitwan Tourism Hub</b> is a planned, gated community of private pool villas in Dibyanagar, Chitwan, close to Chitwan's tourism
area. Sheetal Property is opening it to investors.</p>
<p>The site has 97 plots with internal roads, two open spaces and land set aside for business use. Its first homes are 2BHK single-storey
villas, each with its own pool, deck and garden, suited to living, holiday homes and short-stay rental.</p>
${ul(["Planned layout: 97 plots, internal roads, open spaces", "Private pool villas with gardens and two-car parking", "Land for business use inside the project", "Investment amount and terms on request: call or send an enquiry"])}
<p>Send an enquiry or call Sheetal Property for the investment amounts, terms and a site visit.</p>`,
    more: [...HUB_FACTS, ["Investment amount", "On request"], ["Returns and terms", "Shared on request"]],
  },
  {
    kind: "project", category: "Project", propertyType: "Villa",
    title: "Chitwan Tourism Hub: 2BHK private pool villas in Dibyanagar",
    photos: ["14.jpg", "12.jpg", "15.jpg", "11.jpg", "17.jpg", "villa-sheet-1.jpg", "villa-sheet-2.jpg", "plot-map.png", "22.jpg", "18.jpg", "19.jpg", "10.jpg", "9.jpg"],
    facilities: ["Swimming pool", "Parking", "Garden", "Green space", "Gated entrance", "Internal roads"],
    bedrooms: 2, bathrooms: 2, floors: 1, parking: "2 cars", landArea: "10 Aana", landSqft: 3422.5, builtArea: "1236 sq ft",
    description: `<p>Luxury <b>2BHK single-storey villas</b> with a private pool, in Chitwan Tourism Hub, Dibyanagar, Chitwan.</p>
<p>Each villa stands on a 10-aana plot (3,422.5 sq ft) with 1,236 sq ft built: a master bedroom with en-suite, a second bedroom with its
own bathroom, open-plan living and dining on Italian marble, a kitchen with island, a 12'6" × 22'9" swimming pool, a teak-texture deck,
a window sit-out, an entry stair and parking for two cars, all in a tropical garden.</p>
${ul(["Classical arched portico and hipped slate-grey roof", "Floor-to-ceiling glazing to living and dining", "Private pool with deck and loungers", "Plots marked available, sold and booked on the site plan"])}
<p>Price on request. Send an enquiry or book a site visit with Sheetal Property.</p>`,
    more: [...VILLA_FACTS, ...HUB_FACTS.slice(0, 3)],
    units: [{ type: "2 BHK villa", size: 1236, count: null, price: null }],
  },
] as const;

async function main() {
  if (!dir || !existsSync(dir)) throw new Error("Give --dir=<folder with the photos>.");
  const tenant = arg("tenant")
    ? await db.tenant.findUniqueOrThrow({ where: { id: arg("tenant")! } })
    : await db.tenant.findFirstOrThrow({ where: { name: { equals: "Sheetal Property", mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
  const head = await db.branch.findFirstOrThrow({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } });
  const owner = await db.membership.findFirst({ where: { tenantId: tenant.id, status: "active", role: { key: "owner" } }, select: { userId: true } });
  console.log(`Business: ${tenant.name} (${tenant.id}), branch ${head.name}. ${apply ? "APPLYING" : "dry run"}.`);

  for (const L of LISTINGS) {
    const missing = L.photos.filter((f) => !existsSync(join(dir, f)));
    if (missing.length) throw new Error(`Missing photos: ${missing.join(", ")}`);
    const had = await db.listing.findFirst({ where: { tenantId: tenant.id, title: L.title, deletedAt: null }, select: { code: true } });
    if (had) { console.log(`= ${had.code} already there: ${L.title}`); continue; }
    console.log(`+ ${L.kind}: ${L.title} (${L.photos.length} photos)`);
    if (!apply) continue;
    const files: string[] = [];
    for (const f of L.photos) files.push(await savePhoto(config.MEDIA_DIR, readFileSync(join(dir, f))));
    const now = new Date();
    const l = await db.listing.create({
      data: {
        code: `TMP-${Date.now()}`, slug: `tmp-${Date.now()}`, tenantId: tenant.id, branchId: head.id, userId: owner?.userId ?? null, createdBy: owner?.userId ?? null,
        kind: L.kind, purpose: "sale", category: L.category, propertyType: L.propertyType, title: L.title, description: L.description,
        status: "published", publishedAt: now, submittedAt: now, reviewedAt: now, price: null,
        province: "Bagmati", district: "Chitwan", area: "Dibyanagar",
        bedrooms: "bedrooms" in L ? L.bedrooms : null, bathrooms: "bathrooms" in L ? L.bathrooms : null, floors: "floors" in L ? L.floors : null,
        parking: "parking" in L ? L.parking : null, landArea: "landArea" in L ? L.landArea : null, landSqft: "landSqft" in L ? L.landSqft : null,
        builtArea: "builtArea" in L ? L.builtArea : null, facilities: [...L.facilities],
        details: { more: L.more, ...("units" in L ? { units: L.units } : {}) },
        photos: { create: files.map((file, sort) => ({ file, sort })) },
      },
    });
    const code = listingCode(await prefixFor(db, tenant.id), l.id);
    await db.listing.update({ where: { id: l.id }, data: { code, slug: `${slugify(L.title)}-${l.id}` } });
    console.log(`  posted ${code}: /property/${slugify(L.title)}-${l.id}`);
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => db.$disconnect());
