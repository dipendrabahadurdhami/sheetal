// Posts Munal and Mayur Resort (Chitwan) on Sheetal under its own business "Munal And Mayur", from its website munalandmayur.com
// (read on 27 Nov 2026 at the owner's request): the resort, its 8 room types with prices in Nepali rupees, facilities, dining, spa,
// rules and cancellation, and the photos from its site.
// Run:   npx tsx scripts/post-munal-mayur.ts [--tenant=<id>] [--apply]
// Without --apply it only says what it would do. Safe to run twice (same title = left alone). Prices are the site's rupee prices that
// day (the offer price, with the normal price in the details); they follow the exchange rate on the hotel's site, so check them now and then.

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
const SITE = "https://munalandmayur.com/storage";

const ROOM_AMENITIES = ["TV", "Free Wi-Fi", "Safe", "Hot and cold shower", "Air conditioning", "Mini bar", "Towels", "Electric kettle", "Phone",
  "Alkaline water", "Hair dryer on request", "Tea and tea bags", "Work desk", "Toiletries", "Slippers", "RFID key-card door"];
// name, bed, beds, guests, sqm, offer price, normal price, breakfast, special, extras
const ROOMS: [string, string, number, number, number, number, number, boolean, string, string[]][] = [
  ["Kasturi Superior King (garden view)", "King", 1, 2, 30, 6000, 6912, true, "Garden view", []],
  ["Kasturi Superior Twin (garden view)", "Twin", 2, 2, 30, 6000, 6912, true, "Garden view", []],
  ["Rhino Superior Cottage (pool view)", "1 double + 1 twin", 1, 3, 42, 8500, 10041, true, "Standalone cottage with veranda facing the pool", ["Sitting area"]],
  ["Kasturi Wellness Suite with private jacuzzi", "King", 1, 2, 46, 9750, 11666, true, "Private in-room jacuzzi", ["Massage table", "Bathrobe", "Sitting area"]],
  ["Kasturi Wellness Suite with private sauna", "King", 1, 2, 46, 9750, 11666, false, "Private in-room sauna", ["Massage table", "Bathrobe", "Sitting area"]],
  ["Panda Deluxe Wellness Villa with private jacuzzi", "King", 1, 2, 46, 10000, 12324, false, "Standalone villa with private jacuzzi", ["Massage table", "Bathrobe", "Sitting area"]],
  ["Panda Deluxe Wellness Villa with private sauna", "King", 1, 2, 46, 10000, 12324, false, "Standalone villa with private sauna", ["Massage table", "Bathrobe", "Sitting area"]],
  ["Munal Private Pool Villa (deluxe 2-bedroom)", "1 king + 1 queen + 1 single", 1, 4, 120, 31755, 35308, false, "Two bedrooms, living area and a private outdoor pool", ["Private pool", "Living area", "Massage table", "Bathrobe"]],
];
const PHOTOS = [
  "2025/09/munal-and-mayur-resort-property.jpg", "2025/10/munal-and-mayur-resort-swimming-pool-chitwan.jpg", "2025/09/munal-and-mayur-resort-villa.jpg",
  "2022/08/munal-private-pool-villa.jpg", "2022/08/kasturi-superior-king.jpg", "2022/08/rhino-superior-cottage.jpg", "2025/09/kasturi-wellness-suite-jaccuzzi.jpg",
  "2022/08/kasturi-wellness-suite-sauna.jpg", "2025/09/panda-deluxe-wellness-villa-jacuzzi.jpg", "2022/08/panda-deluxe-wellness-villa-sauna.jpg",
  "2022/08/kasturi-superior-twin.jpg", "2022/08/munal-private-pool-villa-king-bed-room.jpg", "2022/08/munal-private-pool-villa-setting-room.jpg",
  "2022/08/kasturi-superior-king-patio-balcony.jpg", "2025/09/munal-and-mayur-resort-appetito-restaurant.jpg", "2025/09/munal-and-mayur-resort-the-palm-cafe-and-bar.jpg",
  "2025/09/munal-and-mayur-resort-restaurant.jpg", "2025/09/munal-and-mayur-resort-spa.jpg", "2022/08/kasturi-wellness-suite-spa-sauna.jpg",
  "2022/08/kasturi-superior-king-amenities.jpg",
].map((p) => `${SITE}/${p}`);

const TITLE = "Munal and Mayur Resort: 4-star resort with pool, spa and private villas near Chitwan National Park";
const FACILITIES = ["Infinity swimming pool", "Spa", "Restaurant", "Bar and café", "Room service", "Free Wi-Fi", "Air conditioning", "Free parking",
  "In-room safe", "Concierge", "In-house laundry", "Medical kit", "Safari packages", "Conference and event hall", "Garden"];
const RULES = ["No smoking", "No pets", "Swimming pool closed from 10 PM to 7 AM", "Guests must be 18 or older to book; under 18 need a parent or guardian's permission"];

async function main() {
  const tenant = arg("tenant")
    ? await db.tenant.findUniqueOrThrow({ where: { id: arg("tenant")! } })
    : await db.tenant.findFirstOrThrow({ where: { name: { equals: "Munal And Mayur", mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
  const head = await db.branch.findFirstOrThrow({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } });
  const owner = await db.membership.findFirst({ where: { tenantId: tenant.id, status: "active", role: { key: "owner" } }, select: { userId: true } });
  console.log(`Business: ${tenant.name} (${tenant.type}). ${apply ? "APPLYING" : "dry run"}. ${ROOMS.length} room types, ${PHOTOS.length} photos.`);
  const had = await db.listing.findFirst({ where: { tenantId: tenant.id, title: TITLE, deletedAt: null }, select: { code: true } });
  if (had) { console.log(`= ${had.code} already there`); return; }
  if (!apply) return;

  const files: string[] = [];
  for (const url of PHOTOS) {
    const r = await fetch(url, { headers: { "user-agent": "SheetalPropertyListingImport/1.0" } });
    if (!r.ok) { console.log(`  skip ${url} (${r.status})`); continue; }
    files.push(await savePhoto(config.MEDIA_DIR, Buffer.from(await r.arrayBuffer())));
  }
  const description = `<p><b>Munal and Mayur Resort</b> is a 4-star resort with 30 rooms near <b>Chitwan National Park</b>, at Kalika-1, Lankalaine,
Chitwan. Inspired by traditional Tharu architecture with modern comfort, it offers rooms, cottages, wellness suites and private villas set
in green gardens around an infinity pool.</p>
<p>Its name joins the Munal (Himalayan monal) and the Mayur (peacock): founded by people from the Himalaya, the hills and the Tarai, the resort
celebrates Nepal's unity and a complete Nepali experience.</p>
<p><b>Rooms and prices</b> (per night):</p>
<ul>${ROOMS.map(([n, bed, , g, sqm, p, np, bf, sp]) => `<li><b>${n}</b>: ${bed} bed${bed.includes("+") ? "s" : ""}, up to ${g} guests, ${sqm} m². ${sp}. ${rs(p)} a night (normally ${rs(np)})${bf ? ", breakfast included" : ""}.</li>`).join("")}</ul>
<p><b>Dining:</b> Appetito Restaurant serves local ingredients with an international touch, with hearty breakfasts and dinners indoors or
facing the garden. The Palm Café and Bar, steps from the pool, serves handcrafted drinks, coffee and light bites.</p>
<p><b>Spa:</b> Ayurvedic massage, deep tissue therapy and herbal treatments. <b>Safari:</b> guided jungle safari packages in Chitwan National Park.
<b>Events:</b> halls, lawns and meeting rooms for conferences, weddings and celebrations, with catering.</p>
<p><b>Cancellation:</b> free up to 1 day before check-in; same-day cancellation is charged in full. Payment by cash or card (Visa, MasterCard);
Nepali rupees, Indian rupees, US dollars and euros accepted.</p>
<p>Contact: +977 985-5084235 · info@munalandmayur.com</p>`;
  const more: [string, string][] = [
    ["Address", "Kalika-1, Lankalaine, Chitwan"], ["Stars", "4-star resort"], ["Rooms", "30"],
    ...ROOMS.map(([n, , , , , p, np, bf]): [string, string] => [n, `${rs(p)} a night (normally ${rs(np)})${bf ? ", breakfast included" : ""}`]),
    ["Room amenities", ROOM_AMENITIES.join(", ")],
    ["Restaurant", "Appetito Restaurant; The Palm Café and Bar by the pool"], ["Spa", "Ayurvedic, deep tissue and herbal treatments"],
    ["Cancellation", "Free up to 1 day before check-in; same-day: full charge"], ["Payment", "Cash or card (Visa, MasterCard); NPR, INR, USD, EUR"],
    ["Phone", "+977 985-5084235"], ["Email", "info@munalandmayur.com"], ["Website", "munalandmayur.com"],
  ];
  const now = new Date();
  const l = await db.listing.create({
    data: {
      code: `TMP-${Date.now()}`, slug: `tmp-${Date.now()}`, tenantId: tenant.id, branchId: head.id, userId: owner?.userId ?? null, createdBy: owner?.userId ?? null,
      kind: "stay_hotel", purpose: "rent", category: "Stay", propertyType: "Resort", title: TITLE, description,
      status: "published", publishedAt: now, submittedAt: now, reviewedAt: now, price: BigInt(Math.min(...ROOMS.map((r) => r[5]))), pricePer: "night",
      province: "Bagmati", district: "Chitwan", area: "Lankalaine, Kalika-1", facilities: FACILITIES,
      details: {
        stars: "4 star", cancellation: "Free up to 1 day before check-in",
        rooms: ROOMS.map(([type, bed, beds, guests, sqm, price, , , view, extra]) => ({ type, bed, beds, guests, size: Math.round(sqm * 10.764), view, price, amenities: [...ROOM_AMENITIES.slice(0, 6), ...extra] })),
        max_guests: 4, house_rules: RULES, more,
      },
      photos: { create: files.map((file, sort) => ({ file, sort })) },
    },
  });
  const code = listingCode(await prefixFor(db, tenant.id), l.id);
  await db.listing.update({ where: { id: l.id }, data: { code, slug: `${slugify(TITLE)}-${l.id}` } });
  console.log(`posted ${code} with ${files.length} photos: /property/${slugify(TITLE)}-${l.id}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => db.$disconnect());
