// Posts a Sheetal Apartments location as a stay on the website (the owner's photos and rate card of 27 Nov 2026).
// Run:   npx tsx scripts/post-sheetal-apartments.ts --place=hattigauda --dir=<photos folder> [--tenant=<id>] [--apply]
// Without --apply it only says what it would do. Safe to run twice: a listing with the same title for the business is left alone.
// Each place is one stay listing with its apartment types as rooms (price per night), the long-stay rates, facilities, house rules and
// what is nearby. Boudha is added here when its photos come. Distances are approximate ("about"); the business can edit them later.

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
const rs = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;

// Apartment-wide facilities (the owner: lift, Wi-Fi, AC, fridge, attached bathrooms, electricity, and what the photos show).
const FACILITIES = ["Free Wi-Fi", "Air conditioning", "Lift", "Refrigerator", "Kitchen with gas stove", "Dining table", "Smart TV", "Attached bathroom",
  "Hot shower", "Towels and toiletries", "Washing machine", "Balcony", "City and mountain view", "24-hour electricity", "Fully furnished"];
const RULES = ["No smoking inside", "No parties or loud music after 10 PM", "Valid ID for every guest at check-in", "Pets on request"];

type Unit = { type: string; beds: string; bedrooms: number; guests: number; night: number; n3: number; n7: number; n15: number; n30: number; about: string };
const PLACES: Record<string, { title: string; area: string; city: string; district: string; intro: string; units: Unit[]; nearby: [string, string][] }> = {
  hattigauda: {
    title: "Sheetal Apartments Hattigauda: furnished 1BHK and 3BHK stays, Budhanilkantha",
    area: "Hattigauda", city: "Budhanilkantha", district: "Kathmandu",
    intro: `Fully furnished apartments in <b>Hattigauda, Budhanilkantha</b>, on the quiet north side of Kathmandu, for a night, a week or a month.
Warm wooden floors and lighting, air-conditioned bedrooms, a bright living and dining room, a kitchen with gas, and a long balcony with a view
over the city to the hills. Run by Sheetal Property.`,
    units: [
      { type: "1BHK apartment", beds: "1 bedroom", bedrooms: 1, guests: 2, night: 5500, n3: 5300, n7: 5000, n15: 55000, n30: 90000, about: "Bedroom, living and dining, kitchen and bathroom" },
      { type: "3BHK apartment", beds: "3 bedrooms", bedrooms: 3, guests: 6, night: 10000, n3: 9800, n7: 9500, n15: 80000, n30: 130000, about: "Three bedrooms, living and dining, kitchen and bathrooms" },
    ],
    nearby: [
      ["Budhanilkantha Temple (Sleeping Vishnu)", "about 3 km"],
      ["Shivapuri Nagarjun National Park, Budhanilkantha gate", "about 4 km"],
      ["Budhanilkantha School", "about 2 km"],
      ["Grande International Hospital, Dhapasi", "about 5 km"],
      ["Maharajgunj and the Ring Road", "about 5 km"],
      ["Thamel", "about 9 km"],
      ["Tribhuvan International Airport", "about 12 km"],
    ],
  },
};

async function main() {
  const place = arg("place") ?? "";
  const P = PLACES[place];
  if (!P) throw new Error(`Give --place=${Object.keys(PLACES).join("|")}`);
  const dir = arg("dir");
  if (!dir || !existsSync(dir)) throw new Error("Give --dir=<folder with the photos> (sorted by name: the first is the cover).");
  const photos = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  if (photos.length < 3) throw new Error("At least 3 photos, please.");
  const tenant = arg("tenant")
    ? await db.tenant.findUniqueOrThrow({ where: { id: arg("tenant")! } })
    : await db.tenant.findFirstOrThrow({ where: { name: { equals: "Sheetal Property", mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
  const head = await db.branch.findFirstOrThrow({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } });
  const owner = await db.membership.findFirst({ where: { tenantId: tenant.id, status: "active", role: { key: "owner" } }, select: { userId: true } });
  console.log(`Business: ${tenant.name}. ${apply ? "APPLYING" : "dry run"}. ${P.title} (${photos.length} photos: ${photos.join(", ")})`);
  const had = await db.listing.findFirst({ where: { tenantId: tenant.id, title: P.title, deletedAt: null }, select: { code: true } });
  if (had) { console.log(`= ${had.code} already there`); return; }
  if (!apply) return;

  const lowest = Math.min(...P.units.map((u) => u.night));
  const description = `<p>${P.intro}</p>
<p><b>Apartments and prices</b> (per night, the more nights the lower the price):</p>
<ul>${P.units.map((u) => `<li><b>${u.type}</b>: ${u.about}; up to ${u.guests} guests. ${rs(u.night)} a night; ${rs(u.n3)} a night for 3+ nights; ${rs(u.n7)} a night for 7+ nights; ${rs(u.n15)} for 15 nights; ${rs(u.n30)} for 30 nights.</li>`).join("")}</ul>
<p><b>In every apartment:</b> ${FACILITIES.join(", ")}.</p>
<p>Call, WhatsApp or send an enquiry with your dates to book. Long stays (15 and 30 nights) are welcome.</p>`;
  const more: [string, string][] = [
    ["Location", `${P.area}, ${P.city}, ${P.district}`],
    ...P.units.flatMap((u): [string, string][] => [
      [`${u.type}: 1 night`, rs(u.night)], [`${u.type}: 3+ nights`, `${rs(u.n3)} a night`], [`${u.type}: 7+ nights`, `${rs(u.n7)} a night`],
      [`${u.type}: 15 nights`, `${rs(u.n15)} in total`], [`${u.type}: 30 nights`, `${rs(u.n30)} in total`],
    ]),
    ...P.nearby.map(([k, v]): [string, string] => [`Nearby: ${k}`, v]),
  ];
  const files: string[] = [];
  for (const f of photos) files.push(await savePhoto(config.MEDIA_DIR, readFileSync(join(dir, f))));
  const now = new Date();
  const l = await db.listing.create({
    data: {
      code: `TMP-${Date.now()}`, slug: `tmp-${Date.now()}`, tenantId: tenant.id, branchId: head.id, userId: owner?.userId ?? null, createdBy: owner?.userId ?? null,
      kind: "stay_unit", purpose: "rent", category: "Stay", propertyType: "Serviced apartment", title: P.title, description,
      status: "published", publishedAt: now, submittedAt: now, reviewedAt: now, price: BigInt(lowest), pricePer: "night",
      province: "Bagmati", district: P.district, city: P.city, area: P.area, furnishing: "Fully furnished", facilities: FACILITIES,
      details: {
        rooms: P.units.map((u) => ({ type: `${u.type} (${u.beds})`, bed: "Double", beds: u.bedrooms, guests: u.guests, price: u.night, amenities: ["Air conditioning", "Free Wi-Fi", "Attached bathroom"] })),
        check_in: "14:00", check_out: "12:00", min_nights: 1, max_guests: Math.max(...P.units.map((u) => u.guests)),
        house_rules: RULES, nearby: P.nearby.map(([k]) => k), kitchen: ["Gas stove", "Refrigerator", "Dining table", "Cooking basics"],
        bathroom_items: ["Hot shower", "Towels", "Toiletries"], more,
      },
      photos: { create: files.map((file, sort) => ({ file, sort })) },
    },
  });
  const code = listingCode(await prefixFor(db, tenant.id), l.id);
  const slug = `${slugify(P.title)}-${l.id}`;
  await db.listing.update({ where: { id: l.id }, data: { code, slug } });
  console.log(`posted ${code}: /property/${slug}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => db.$disconnect());
