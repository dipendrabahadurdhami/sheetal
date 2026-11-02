// Imports the old Laravel site from its MySQL backup into the new database.
//   npm run import:old -w @sheetal/website-api -- --dump <path to database-full.sql> [--dry-run]
// Safe to run again: rows are matched by their old id and updated.
//
// What comes over (decisions in docs/old-backend-audit.md):
// - Users: all of them, with their old role shown. No password: they get a link to set a new one on first login.
// - Listings: all of them, live (they never expire; the check-ups keep them correct), owned by Sheetal Property.
//   Missing details are filled from the title and description; what was filled is kept in `suggest` for review.
//   Owner details, lalpurja numbers and commission go to `private`, which the website never receives.
// - Photos: the cover first, then the gallery, only files that exist in MEDIA_DIR/property/main.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/backend-core/config";
import { createDb } from "@sheetal/backend-core/lib/db";

type Row = Record<string, string | number | null>;

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = args.includes("--dry-run");
const dumpPath = arg("--dump");
if (!dumpPath || !existsSync(dumpPath)) {
  console.error("Usage: npm run import:old -w @sheetal/website-api -- --dump <database-full.sql> [--dry-run]");
  process.exit(1);
}

// ───────────── Reading the MySQL dump ─────────────

/** Column names of every table, from its CREATE TABLE. */
function columnsOf(sql: string) {
  const out = new Map<string, string[]>();
  for (const m of sql.matchAll(/CREATE TABLE `(\w+)` \(\n([\s\S]*?)\n\)/g)) {
    out.set(m[1]!, [...m[2]!.matchAll(/^\s+`(\w+)`/gm)].map((c) => c[1]!));
  }
  return out;
}

/** Values of one INSERT statement: (a,'b',NULL),(…) → arrays, handling quotes and backslash escapes. */
function tuples(values: string): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  let row: (string | number | null)[] = [];
  let i = 0;
  const ESC: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0", Z: "\x1a" };
  while (i < values.length) {
    const c = values[i]!;
    if (c === "(") { row = []; i++; continue; }
    if (c === ")") { rows.push(row); i++; continue; }
    if (c === "," || c === ";" || c === " " || c === "\n") { i++; continue; }
    if (c === "'") {
      let s = "";
      i++;
      while (i < values.length) {
        const d = values[i]!;
        if (d === "\\") { const e = values[i + 1]!; s += ESC[e] ?? e; i += 2; continue; }
        if (d === "'") { if (values[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
        s += d; i++;
      }
      row.push(s);
      continue;
    }
    let j = i;
    while (j < values.length && values[j] !== "," && values[j] !== ")") j++;
    const raw = values.slice(i, j).trim();
    row.push(raw === "NULL" ? null : Number.isFinite(Number(raw)) ? Number(raw) : raw);
    i = j;
  }
  return rows;
}

function readTables(path: string, wanted: string[]) {
  const sql = readFileSync(path, "utf8");
  const cols = columnsOf(sql);
  const out: Record<string, Row[]> = {};
  for (const t of wanted) {
    const names = cols.get(t);
    if (!names) throw new Error(`Table ${t} is not in the dump`);
    out[t] = [];
    for (const m of sql.matchAll(new RegExp(`^INSERT INTO \`${t}\` VALUES (.*);$`, "gm"))) {
      for (const v of tuples(m[1]!)) out[t]!.push(Object.fromEntries(names.map((n, k) => [n, v[k] ?? null])));
    }
  }
  return out;
}

// ───────────── Cleaning values ─────────────

const str = (v: unknown) => { const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim(); return s && !/^(null|n\/a|-|0)$/i.test(s) ? s : null; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9.]/g, ""), 10); return Number.isFinite(n) && n > 0 && n < 1000 ? n : null; };
const float = (v: unknown) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) && n > 0 ? n : null; };
const date = (v: unknown) => { const d = v ? new Date(String(v).replace(" ", "T") + "Z") : null; return d && !isNaN(+d) ? d : null; };
const titleCase = (s: string | null) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : null);
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "property";

/** Removes scripts, frames, inline event handlers and javascript: links; keeps the owner's formatting. */
function cleanHtml(v: unknown) {
  const s = str(v) === null ? null : String(v);
  if (!s) return null;
  const out = s
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|meta|link)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=\"#\"")
    // Tidy, without changing the owner's words: no empty paragraphs, runs of spaces or piles of line breaks.
    .replace(/(&nbsp;| )+/g, " ")
    .replace(/<p>(\s|<br\s*\/?>)*<\/p>/gi, "")
    .replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\r?\n\s*\r?\n(\s*\r?\n)+/g, "\n\n")
    .trim();
  return out.replace(/<[^>]*>|&nbsp;|\s/g, "") ? out : null;
}
const text = (html: string | null) => (html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

/** What the listing offers, from what its title says it is (the old site only had sale and rent).
 *  Only the thing being offered counts: "House for rent, ideal for a hostel" is still a house for rent. */
function kindOf(title: string, purpose: "sale" | "rent", oldPurposeId: number): { kind: string; why?: string } {
  // "…near CG Housing" describes the neighbourhood, not what is offered.
  const t = title.replace(/[^\p{L}\p{N}\s/&-]/gu, " ").replace(/\s+/g, " ").replace(/\bnear\b.*$/i, "");
  const subject = t.split(/\b(?:on|for|at|in|near)\b/i)[0] ?? t; // the words before "on sale", "for rent", "at …"
  if (/\b(hotel|hostel|guest ?house|resort|lodge)\b/i.test(subject)) return { kind: "stay_hotel", why: "Title offers a hotel, hostel or guesthouse." };
  if (/\binvest(ment|or)?s?\b/i.test(t) || oldPurposeId === 3) return { kind: "invest", why: "Title offers it as an investment." };
  if (/\b(colony|housing|plotting|plots?)\b/i.test(t)) return { kind: "project", why: "Title offers a colony, housing or plot development." };
  return { kind: purpose === "rent" ? "rentout" : "sell" };
}

// Nepali land units in square feet.
const SQFT = { ropani: 5476, aana: 342.25, paisa: 85.5625, daam: 21.390625, bigha: 72900, katha: 3645, dhur: 182.25, sqm: 10.7639 };

function landOf(p: Row) {
  const parts: string[] = [];
  let sqft = 0;
  const add = (v: unknown, unit: keyof typeof SQFT | "sqft", label: string) => {
    const n = float(v);
    if (!n) return;
    parts.push(`${+n.toFixed(2)} ${label}`);
    sqft += unit === "sqft" ? n : n * SQFT[unit];
  };
  add(p.land_area_in_ropani_lal, "ropani", "Ropani");
  add(p.land_area_in_anna_lal, "aana", "Aana");
  add(p.land_area_in_bigha_lal, "bigha", "Bigha");
  add(p.land_area_in_katha_lal, "katha", "Katha");
  add(p.land_area_in_dhur_lal, "dhur", "Dhur");
  if (!parts.length) add(p.land_area_in_sqft_lal, "sqft", "sq ft");
  if (!parts.length) add(p.land_area_in_meters_lal, "sqm", "sq m");
  return { landArea: parts.join(" ") || null, landSqft: sqft ? Math.round(sqft) : null };
}

/** Details written only in the text ("Bedroom: 5", "Road access-16 ft", "Face: East", "3 Aana 1 paisa"). */
function fromText(t: string) {
  const s = t.replace(/[➡️⏩✅👉️✍️❗*]/gu, " ");
  const found: Record<string, string | number> = {};
  const bed = s.match(/(?:bed\s*rooms?|badrooms?|bed)\s*[:\-–]?\s*(\d{1,2})\b/i) ?? s.match(/\b(\d{1,2})\s*(?:bhk|bed\s*rooms?|bedrooms?)\b/i);
  if (bed) found.bedrooms = Number(bed[1]);
  const bath = s.match(/bath\s*rooms?\s*[:\-–]?\s*(\d{1,2})\b/i) ?? s.match(/\b(\d{1,2})\s*bath\s*rooms?\b/i);
  if (bath) found.bathrooms = Number(bath[1]);
  const road = s.match(/road(?:\s*access)?\s*[:\-–]?\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)\s*(?:ft|feet|fit)/i);
  if (road) found.roadAccess = `${road[1]!.replace(/\s/g, "")} ft`;
  const face = s.match(/fac(?:e|ing)\s*[:\-–]?\s*((?:north|south)?[\s-]?(?:east|west)|north|south)\b/i);
  if (face) found.facing = titleCase(face[1]!.trim().toLowerCase())!;
  const land = s.match(/(\d+(?:\.\d+)?\s*(?:ropani|aana|anna|ana)\b(?:\s*\d+\s*(?:paisa|aana|anna|ana|daam|dam)\b){0,3})/i);
  if (land) found.landArea = land[1]!.replace(/\banna\b|\bana\b/gi, "Aana").replace(/\s+/g, " ").trim();
  const floors = s.match(/(\d(?:\.\d)?)\s*(?:storey|story|floors?)\b/i) ?? s.match(/floors?\s*[:\-–]\s*(\d(?:\.\d)?)/i);
  if (floors) found.floors = Number(floors[1]);
  return found;
}

const PUBLIC_EXTRA: [string, string][] = [
  ["other_description", "other_description"], ["apartment_detail", "apartment_detail"], ["geometry_of_land", "land_shape"],
  ["land_use", "land_use"], ["elevation", "elevation"], ["source_of_waters", "water_source"], ["capacity_of_water_tank", "water_tank"],
  ["main_road_width", "main_road_width"], ["side_road_width", "side_road_width"], ["boundry", "boundary_wall"], ["garage", "garage"],
  ["shutters", "shutters"], ["room_per_floor", "rooms_per_floor"], ["min_lease", "min_lease"], ["min_deposit", "deposit"],
  ["availability_from", "available_from"], ["land_perimeter", "land_perimeter"],
];
const PRIVATE_EXTRA: [string, string][] = [
  ["owner_info", "owner"], ["owner_type", "owner_type"], ["commission", "commission"], ["company_name", "company_name"],
  ["company_phone", "company_phone"], ["company_address", "company_address"], ["lal_purja_no", "lalpurja_no"],
  ["ownership_document", "ownership_document"], ["broker_response", "broker_response"], ["finance_bank_name", "bank"],
  ["loan_amount", "loan_amount"], ["advance", "advance"], ["min_amount", "min_amount"], ["max_amount", "max_amount"],
  ["expiry_date", "old_expiry_date"], ["urgency_id", "old_urgency"],
];
const pick = (p: Row, map: [string, string][]) => Object.fromEntries(map.map(([from, to]) => [to, str(p[from])]).filter(([, v]) => v));

// ───────────── Run ─────────────

loadEnvFiles();
const config = loadConfig(process.env, "website");
const db = createDb(config.DATABASE_URL);
if (!db) { console.error("DATABASE_URL is not set (backend-core/.env)."); process.exit(1); }

console.log(`Reading ${dumpPath}…`);
const T = readTables(dumpPath, ["users", "roles", "model_has_roles", "properties", "property_galleries", "purposes", "property_types", "categories", "property_categories", "facilities", "property_facilities"]);
const name = (rows: Row[], key = "name") => new Map(rows.map((r) => [Number(r.id), str(r[key])]));
const roleName = name(T.roles!);
const rolesOf = new Map<number, string[]>();
for (const r of T.model_has_roles!) { const n = roleName.get(Number(r.role_id)); if (n) rolesOf.set(Number(r.model_id), [...(rolesOf.get(Number(r.model_id)) ?? []), n]); }
const typeName = name(T.property_types!);
const catName = name(T.categories!);
const facName = name(T.facilities!);
const facsOf = new Map<number, string[]>();
for (const f of T.property_facilities!) { const n = facName.get(Number(f.facility_id)); if (n) facsOf.set(Number(f.property_id), [...new Set([...(facsOf.get(Number(f.property_id)) ?? []), n])]); }
const galleryOf = new Map<number, string[]>();
for (const g of [...T.property_galleries!].sort((a, b) => Number(a.id) - Number(b.id))) { const f = str(g.filename); if (f) galleryOf.set(Number(g.property_id), [...(galleryOf.get(Number(g.property_id)) ?? []), f]); }

const mainDir = config.MEDIA_DIR ? join(config.MEDIA_DIR, "property", "main") : null;
const photosOnDisk = mainDir && existsSync(mainDir) ? new Set(readdirSync(mainDir)) : null;
if (!photosOnDisk) console.warn("MEDIA_DIR is not set or has no property/main folder: photos are linked without checking they exist.");

console.log(`Found ${T.users!.length} users and ${T.properties!.length} listings.`);
if (dryRun) {
  const sample = T.properties![0]!;
  console.log("Dry run: first listing would be", { id: sample.id, code: sample.property_code, title: sample.name, fromText: fromText(text(String(sample.property_description ?? ""))) });
  process.exit(0);
}

const sheetal = await db.tenant.findFirst({ where: { OR: [{ email: "shetalrealestate@gmail.com" }, { name: "Sheetal Property" }], type: "agency" } });
if (!sheetal) { console.error("Sheetal Property is not in the database yet. Run `npm run db:seed` first."); process.exit(1); }

// Users
const userIdOf = new Map<number, string>();
let usersNew = 0, usersSkipped = 0;
for (const u of T.users!) {
  const email = str(u.email)?.toLowerCase();
  if (!email || !email.includes("@")) { usersSkipped++; continue; }
  const legacyRole = [...(rolesOf.get(Number(u.id)) ?? []), str(u.role)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || null;
  const data = {
    userName: str(u.user_name) ?? ([str(u.first_name), str(u.last_name)].filter(Boolean).join(" ") || email.split("@")[0]!),
    firstName: str(u.first_name), lastName: str(u.last_name),
    phone: str(u.mobile) ?? str(u.phone), address: [str(u.address_1), str(u.city)].filter(Boolean).join(", ") || null,
    legacyRole, emailVerifiedAt: date(u.email_verified_at),
  };
  const existing = await db.user.findFirst({ where: { OR: [{ legacyId: Number(u.id) }, { email }] } });
  if (existing) {
    // Never touch the password or staff role of an account that already exists here.
    await db.user.update({ where: { id: existing.id }, data: { legacyId: existing.legacyId ?? Number(u.id), legacyRole: existing.legacyRole ?? legacyRole } });
    userIdOf.set(Number(u.id), existing.id);
  } else {
    const created = await db.user.create({ data: { ...data, email, legacyId: Number(u.id), userType: legacyRole?.toLowerCase().includes("agent") ? "agent" : "user", createdAt: date(u.created_at) ?? new Date() } });
    userIdOf.set(Number(u.id), created.id);
    usersNew++;
  }
}

// Listings
const usedSlugs = new Set((await db.listing.findMany({ select: { slug: true, legacyId: true } })).filter((l) => !l.legacyId).map((l) => l.slug));
const today = new Date();
const kinds = new Map<string, number>();
let n = 0, photosLinked = 0, photosMissing = 0, filledFromText = 0, withPoint = 0;
const total = T.properties!.length;
for (const p of [...T.properties!].sort((a, b) => Number(a.id) - Number(b.id))) {
  const id = Number(p.id);
  const title = str(p.name) ?? `Property ${id}`;
  let slug = slugify(str(p.url) ?? `${title}-${id}`);
  if (usedSlugs.has(slug)) slug = `${slug}-${id}`;
  usedSlugs.add(slug);

  const description = cleanHtml(p.property_description);
  const highlights = cleanHtml(p.property_highlights);
  const guess = fromText(`${title} ${text(highlights)} ${text(description)}`);
  const land = landOf(p);
  const suggest: Record<string, string | number> = {};
  const fill = <T>(column: T | null, key: string): T | null => {
    if (column != null || guess[key] == null) return column;
    suggest[key] = guess[key]!;
    return guess[key] as T;
  };

  const status: "sold" | "rented" | "published" = Number(p.sold) === 1 || Number(p.property_status) === 10 ? "sold" : Number(p.property_status) === 9 ? "rented" : "published";
  // Sale or rent: the old purpose field is sometimes wrong ("House On Sale…" saved as rent at Rs. 4.75 crore a month).
  // When the title says one thing only and the price agrees with it, the title wins; when they disagree, it's flagged.
  let purpose: "rent" | "sale" = Number(p.purpose_id) === 1 ? "rent" : "sale";
  const rawPrice = float(p.total_price) ?? float(p.rent_per_month) ?? float(p.selling_price);
  const saysSale = /\b(on|for)\s*sale\b|\bsell(ing)?\b/i.test(title), saysRent = /\b(on|for)\s*rent\b|\bto[\s-]?let\b|\blease\b/i.test(title);
  const RENT_MAX = 2_000_000; // above Rs. 20 lakh a month it is a sale price
  if (purpose === "rent" && saysSale && !saysRent && (rawPrice ?? 0) > RENT_MAX) { purpose = "sale"; suggest.purpose = "sale (title and price)"; }
  else if (purpose === "sale" && saysRent && !saysSale && rawPrice && rawPrice <= RENT_MAX) { purpose = "rent"; suggest.purpose = "rent (title and price)"; }
  else if ((purpose === "rent" && (rawPrice ?? 0) > RENT_MAX) || (purpose === "sale" && saysRent && !saysSale)) suggest.check = "Sale or rent? The title, purpose and price don't agree.";
  const rent = float(p.rent_per_month);
  const priceNum = purpose === "rent" ? rent ?? float(p.total_price) : float(p.total_price) ?? float(p.selling_price);
  const lat = float(p.lat), lng = float(p.lng);
  const inNepal = lat && lng && lat > 26 && lat < 31 && lng > 80 && lng < 89;
  if (inNepal) withPoint++;
  const category = catName.get(Number(p.category_id)) ?? ({ Home: "House", Apartment: "Apartment", Land: "Land" } as Record<string, string>)[String(p.propertycategory)] ?? "House";
  const created = date(p.created_at) ?? today;
  const perAnna = str(p.price_per_anna) ?? str(p.anna_price);

  const sorted = kindOf(title, purpose, Number(p.purpose_id));
  if (sorted.why) suggest.kind = `${sorted.kind}: ${sorted.why}`;
  kinds.set(sorted.kind, (kinds.get(sorted.kind) ?? 0) + 1);

  const data = {
    kind: sorted.kind,
    code: str(p.property_code)?.toUpperCase() ?? `SP-${String(id).padStart(4, "0")}`,
    slug, tenantId: sheetal.id, userId: userIdOf.get(Number(p.user_id)) ?? null,
    purpose, category, propertyType: titleCase(typeName.get(Number(p.propertytype_id)) ?? null),
    title, description, highlights, status,
    price: priceNum ? BigInt(Math.round(priceNum)) : null,
    pricePer: purpose === "rent" ? "month" : perAnna ? `Rs. ${perAnna} per aana` : null,
    province: titleCase(str(p.zone)), district: titleCase(str(p.district)), city: titleCase(str(p.town)),
    area: titleCase(str(p.tol) ?? str(p.property_location)), street: str(p.street), ward: str(p.ward_no),
    lat: inNepal ? lat : null, lng: inNepal ? lng : null,
    bedrooms: fill(int(p.bedrooms), "bedrooms"), bathrooms: fill(int(p.bathrooms), "bathrooms"),
    kitchens: int(p.kitchens), livingRooms: int(p.living_room), floors: fill(float(p.floors), "floors"),
    parking: str(p.parking), landArea: fill(land.landArea, "landArea"), landSqft: land.landSqft,
    builtArea: str(p.land_area_in_sqft_mes) ? `${str(p.land_area_in_sqft_mes)} sq ft` : null,
    roadAccess: fill(str(p.road_access) ?? str(p.road_wide_facing_the_land), "roadAccess"), roadType: str(p.status_of_road),
    facing: fill(titleCase(str(p.land_facing)), "facing"), builtYear: str(p.completion_year),
    facilities: facsOf.get(id) ?? [], youtubeUrl: str(p.youtube_url),
    details: pick(p, PUBLIC_EXTRA) as Prisma.InputJsonValue,
    private: pick(p, PRIVATE_EXTRA) as Prisma.InputJsonValue,
    featured: Number(p.is_featured) === 1 || str(p.advertisement_type) === "featured",
    featuredOrder: Number(p.featured_order) || 0,
    views: Number(p.views) || 0,
    suggest: Object.keys(suggest).length ? (suggest as Prisma.InputJsonValue) : undefined,
    // Spread the first check-ups over the next 90 days so the team gets a steady few each day.
    checkDueAt: new Date(today.getTime() + ((n % 90) + 1) * 864e5),
    publishedAt: created, createdAt: created,
  };
  if (Object.keys(suggest).length) filledFromText++;

  const files = [...new Set([str(p.feature_image), ...(galleryOf.get(id) ?? [])].filter((f): f is string => !!f))];
  const present = photosOnDisk ? files.filter((f) => photosOnDisk.has(f)) : files;
  photosLinked += present.length;
  photosMissing += files.length - present.length;

  await db.$transaction([
    db.listing.upsert({ where: { legacyId: id }, create: { ...data, id, legacyId: id }, update: data }),
    db.listingPhoto.deleteMany({ where: { listingId: id } }),
    db.listingPhoto.createMany({ data: present.map((file, sort) => ({ listingId: id, file, sort })) }),
  ]);
  if (++n % 250 === 0) console.log(`  ${n} / ${total} listings`);
}
// New listings continue after the highest imported id.
await db.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('listings', 'id'), GREATEST((SELECT MAX(id) FROM listings), 1))`);

const byStatus = await db.listing.groupBy({ by: ["status"], _count: true });
console.log("\nImport finished");
console.log(`  Users:    ${usersNew} new, ${T.users!.length - usersNew - usersSkipped} already here, ${usersSkipped} without an email`);
console.log(`  Listings: ${n} (${byStatus.map((s) => `${s._count} ${s.status}`).join(", ")}), ${withPoint} with a map point`);
console.log(`  Kinds:    ${[...kinds].map(([k, c]) => `${c} ${k}`).join(", ")}`);
console.log(`  Filled from the description (see suggest): ${filledFromText} listings`);
console.log(`  Photos:   ${photosLinked} linked, ${photosMissing} not found on disk`);
await db.$disconnect();
