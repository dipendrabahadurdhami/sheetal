// Tidies the listings already in the database (mostly imported from the old site): reads each title and description,
// fills the fields that are still empty (bedrooms, bathrooms, kitchens, living rooms, floors, built-up area, land
// area, road, facing, furnishing, parking, property type, price, facilities), then writes a short description in
// place of the long one (the facts now sit in their own fields; phone numbers, emails and "inbox us" lines go).
//   npm run listings:tidy -- --dry-run   only writes a report (tidy-listings-report.csv) of what would change
//   npm run listings:tidy                makes the changes (run `npm run backup` first)
//   options: --limit=N (first N listings), --code=SP-0123 (one listing), --keep-description (fill fields only)
// Rules: a field that already has a value is never overwritten; a fact the text doesn't give stays empty.

import { writeFileSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";

loadEnvFiles();
const config = loadConfig(process.env, "website");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const value = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const dry = flag("dry-run"), keepDesc = flag("keep-description");
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });

const AREA = { ropani: 5476, aana: 342.25, paisa: 85.5625, daam: 21.390625, bigha: 72900, kattha: 3645, dhur: 182.25 } as const;
const UNIT: Record<string, keyof typeof AREA> = { ropani: "ropani", ropanis: "ropani", aana: "aana", anna: "aana", ana: "aana", aanas: "aana", paisa: "paisa", dam: "daam", daam: "daam", bigha: "bigha", katha: "kattha", kattha: "kattha", dhur: "dhur" };
const FACING = ["south-east", "south-west", "north-east", "north-west", "east", "west", "north", "south"];
const FACILITY_WORDS: [RegExp, string][] = [
  [/\bwater\b|drinking water|boring/i, "Water supply"], [/electricity|power line/i, "Electricity"], [/wi-?fi|internet/i, "Internet"], [/parking/i, "Parking"],
  [/garden|lawn/i, "Garden"], [/solar/i, "Solar"], [/\blift\b|elevator/i, "Lift"], [/cctv/i, "CCTV"], [/security guard|24.?hour security/i, "Security guard"],
  [/modular kitchen/i, "Modular kitchen"], [/balcony/i, "Balcony"], [/air ?condition|\bac\b/i, "Air conditioning"], [/backup|inverter|generator/i, "Power backup"],
];
const TYPES: [RegExp, string][] = [
  [/office space|office/i, "Office space"], [/shutter/i, "Shutter"], [/shop/i, "Shop space"], [/warehouse|godown/i, "Warehouse"], [/hotel building/i, "Hotel building"],
  [/penthouse/i, "Penthouse"], [/studio/i, "Studio"], [/\bflat\b/i, "Flat"], [/apartment/i, "Apartment unit"], [/bungalow/i, "Bungalow"], [/duplex/i, "Duplex"],
  [/villa/i, "Villa"], [/agricultur|farm ?land|khet/i, "Agricultural land"], [/commercial (land|plot)/i, "Commercial plot"], [/\b(land|plot|ghaderi)\b/i, "Residential plot"],
  [/\bhouse\b|\bghar\b/i, "Residential house"],
];

/** Description HTML as plain lines (emoji and decorations removed). */
const linesOf = (html: string | null) => (html ?? "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
const num = (s?: string) => (s ? Number(s.replace(/,/g, "")) : NaN);
const labelled = (lines: string[], re: RegExp) => { for (const l of lines) { const m = l.match(re); if (m) return m; } return null; };

function read(title: string, html: string | null) {
  const lines = [title, ...linesOf(html)];
  const all = lines.join("\n");
  const f: Record<string, string | number> = {};
  const count = (name: string, words: string) => {
    const m = all.match(new RegExp(`(?:${words})\\s*[:\\-]?\\s*(\\d{1,2})\\b`, "i")) || all.match(new RegExp(`\\b(\\d{1,2})\\s*(?:${words})`, "i"));
    if (m && num(m[1]) >= 0 && num(m[1]) < 50) f[name] = num(m[1]);
  };
  count("bedrooms", "bed ?rooms?|beds?|bhk|bedroom");
  count("bathrooms", "bath ?rooms?|baths?|toilets?|washrooms?");
  count("kitchens", "kitchens?");
  count("livingRooms", "living ?rooms?|halls?|drawing ?rooms?");
  const storey = all.match(/(\d(?:\.\d)?)\s*(?:storey|story|storied|floors? (?:house|building))/i);
  if (storey) f.floors = num(storey[1]);
  const onFloor = labelled(lines, /^floor\s*[:\-]\s*(\d{1,2})\b/i);
  if (onFloor) f.floorNo = num(onFloor[1]);
  const built = all.match(/(?:build ?-?up|built ?-?up|built area|carpet area|covered area|area)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:sq\.? ?ft|sqft|square ?feet|sq\. ?feet)/i) || all.match(/([\d,]+)\s*(?:sq\.? ?ft|sqft)\s*(?:build ?up|built ?up)/i);
  if (built) f.builtArea = `${num(built[1]).toLocaleString("en-IN")} sq ft`;
  // Land: "4 Aana 2 Paisa", "1-4-0-0 ropani", "1 Ropani".
  const land = [...all.matchAll(/(\d+(?:\.\d+)?)\s*(ropanis?|aanas?|anna|ana|paisa|daam|dam|bigha|kattha|katha|dhur)\b/gi)];
  if (land.length) {
    const parts = new Map<keyof typeof AREA, number>();
    for (const m of land.slice(0, 4)) { const u = UNIT[m[2]!.toLowerCase()]; if (u && !parts.has(u)) parts.set(u, num(m[1])); }
    if (parts.size) {
      f.landArea = [...parts].map(([u, n]) => `${n} ${u[0]!.toUpperCase()}${u.slice(1)}`).join(" ");
      f.landSqft = Math.round([...parts].reduce((s, [u, n]) => s + n * AREA[u], 0));
    }
  }
  const road = all.match(/road(?: access| size| width)?\s*[:\-]?\s*(\d{1,3})\s*(?:ft|feet|foot)/i) || all.match(/(\d{1,3})\s*(?:ft|feet|foot)\s*(?:wide\s*)?(?:black ?-?topped |pitched |gravel |concrete )?road/i);
  if (road) f.roadAccess = `${num(road[1])} ft`;
  const roadType = all.match(/black ?-?topped|pitched road|gravel(?:led)? road|concrete road|earthen road/i);
  if (roadType) f.roadType = /black|pitched/i.test(roadType[0]) ? "Blacktopped" : /gravel/i.test(roadType[0]) ? "Gravel" : /concrete/i.test(roadType[0]) ? "Concrete" : "Earthen";
  const facing = all.match(new RegExp(`(${FACING.join("|").replace(/-/g, "[- ]?")})\\s*facing|facing\\s*[:\\-]?\\s*(${FACING.join("|").replace(/-/g, "[- ]?")})`, "i"));
  if (facing) { const d = (facing[1] || facing[2])!.toLowerCase().replace(/\s|-/g, ""); f.facing = { southeast: "South-east", southwest: "South-west", northeast: "North-east", northwest: "North-west" }[d] ?? d[0]!.toUpperCase() + d.slice(1); }
  const furn = all.match(/\b(fully|full|semi|un|non)[- ]?furnished/i);
  if (furn) f.furnishing = /semi/i.test(furn[1]!) ? "Semi furnished" : /un|non/i.test(furn[1]!) ? "Not furnished" : "Fully furnished";
  const parking = labelled(lines, /^parking\s*[:\-]\s*(.{1,40})$/i) || all.match(/(\d+\s*(?:cars?|bikes?)(?:\s*(?:and|&)\s*\d*\s*(?:cars?|bikes?))?)\s*parking/i);
  if (parking) f.parking = parking[1]!.trim().replace(/\.$/, "");
  const type = TYPES.find(([re]) => re.test(title))?.[1];
  if (type) f.propertyType = type;
  const price = labelled(lines, /^(?:price|rent|cost|asking price)\s*[:\-]\s*(?:rs\.?|npr)?\s*([\d,.]+)\s*(crore|cr|lakh|lakhs|lac|k|thousand)?(?:\s*(per|\/))?/i);
  if (price && !price[3]) {
    const mult = /cr/i.test(price[2] ?? "") ? 1e7 : /lak|lac/i.test(price[2] ?? "") ? 1e5 : /k|thousand/i.test(price[2] ?? "") ? 1e3 : 1;
    const p = num(price[1]) * mult;
    if (p >= 1000) f.price = Math.round(p);
  }
  const facilities = FACILITY_WORDS.filter(([re]) => re.test(all)).map(([, n]) => n);
  return { f, facilities };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** A short description from the listing's fields: one sentence on what and where, one on the main facts. */
function summary(l: Prisma.ListingGetPayload<object>, more: [string, string][]) {
  const what = (l.propertyType || l.category || "Property").replace(/^./, (c) => c.toUpperCase());
  const where = [l.area, l.city, l.district].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
  const head = `${what} for ${l.purpose === "rent" ? "rent" : "sale"}${where ? ` in ${where}` : ""}.`;
  const facts = [
    l.landArea && `${l.landArea} of land`, l.builtArea && `${l.builtArea} built-up`, l.floors && `${l.floors} storey`,
    l.bedrooms && plural(l.bedrooms, "bedroom"), l.bathrooms && plural(l.bathrooms, "bathroom"), l.kitchens && plural(l.kitchens, "kitchen"),
    l.livingRooms && plural(l.livingRooms, "living room"), ...more.map(([k, v]) => (k === "On floor" ? `on floor ${v}` : null)),
    l.roadAccess && `${l.roadAccess} road${l.roadType ? ` (${l.roadType.toLowerCase()})` : ""}`, l.facing && `${l.facing.toLowerCase()} facing`,
    l.furnishing && l.furnishing.toLowerCase(), l.parking && `parking: ${l.parking}`,
  ].filter(Boolean);
  const line2 = facts.length ? `${facts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "";
  return `<p>${[head, line2].filter(Boolean).join(" ")}</p>`;
}

const csv = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const where: Prisma.ListingWhereInput = { status: { not: "removed" }, ...(value("code") ? { code: value("code") } : {}) };
const rows = await db.listing.findMany({ where, orderBy: { id: "asc" }, take: Number(value("limit")) || undefined });
const report = [["code", "title", "filled", "new description"].map(csv).join(",")];
let changed = 0, filled = 0;
for (const l of rows) {
  const { f, facilities } = read(l.title, l.description);
  const data: Prisma.ListingUpdateInput = {};
  const set = (k: keyof Prisma.ListingUpdateInput & keyof typeof l, v: unknown) => { const cur = l[k]; if ((cur === null || cur === undefined || cur === "") && v !== undefined) { (data as Record<string, unknown>)[k] = v; filled++; } };
  for (const k of ["bedrooms", "bathrooms", "kitchens", "livingRooms", "floors", "builtArea", "landArea", "landSqft", "roadAccess", "roadType", "facing", "furnishing", "parking", "propertyType"] as const) set(k, f[k]);
  if (f.price && l.price == null) { data.price = BigInt(f.price); filled++; }
  const extra = facilities.filter((x) => !l.facilities.some((y) => y.toLowerCase() === x.toLowerCase()));
  if (extra.length) data.facilities = [...l.facilities, ...extra];
  const details = (l.details ?? {}) as Record<string, unknown>;
  const more = (Array.isArray(details.more) ? details.more : []) as [string, string][];
  if (f.floorNo !== undefined && !more.some(([k]) => k === "On floor")) { more.push(["On floor", String(f.floorNo)]); data.details = { ...details, more } as Prisma.InputJsonValue; }
  const title = l.title.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "").replace(/\s+/g, " ").trim();
  if (title && title !== l.title) data.title = title;
  const next = { ...l, ...(data as object) } as typeof l;
  if (!keepDesc) { const d = summary(next, more); if (d !== l.description) data.description = d; }
  if (!Object.keys(data).length) continue;
  changed++;
  report.push([l.code, title, Object.keys(data).filter((k) => k !== "description").join(" "), (data.description as string | undefined)?.replace(/<[^>]*>/g, "") ?? ""].map(csv).join(","));
  if (!dry) await db.listing.update({ where: { id: l.id }, data });
}
writeFileSync("tidy-listings-report.csv", "\uFEFF" + report.join("\r\n"));
console.log(`${rows.length} listings read, ${changed} ${dry ? "would change" : "changed"}, ${filled} empty fields ${dry ? "would be " : ""}filled.`);
console.log(`Report: backend-core/tidy-listings-report.csv (opens in Excel).${dry ? " Run again without --dry-run to make the changes." : ""}`);
await db.$disconnect();
