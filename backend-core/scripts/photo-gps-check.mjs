// Read-only: compares each listing's pin with the GPS stored inside its photos. Writes photo-gps-report.csv.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "../src/config.js";

loadEnvFiles();
const config = loadConfig(process.env, "website");
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
const media = config.MEDIA_DIR;
if (!media) { console.error("MEDIA_DIR is not set in backend-core/.env"); process.exit(1); }

function gpsOf(buf) {
  if (!buf || buf.length < 14) return null;
  try {
    const o = buf.toString("latin1", 0, 6) === "Exif\0\0" ? 6 : 0;
    const le = buf.toString("latin1", o, o + 2) === "II";
    const u16 = (p) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
    const u32 = (p) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
    const find = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return -1; };
    const gp = find(o + u32(o + 4), 0x8825); if (gp < 0) return null;
    const g = o + u32(gp + 8);
    const deg = (tag) => { const e = find(g, tag); if (e < 0) return null; const p = o + u32(e + 8); const r = (k) => u32(p + k * 8) / (u32(p + k * 8 + 4) || 1); return r(0) + r(1) / 60 + r(2) / 3600; };
    const ref = (tag) => { const e = find(g, tag); return e < 0 ? "" : String.fromCharCode(buf[e + 8]); };
    let lat = deg(2), lng = deg(4);
    if (lat == null || lng == null || (!lat && !lng)) return null;
    if (ref(1) === "S") lat = -lat; if (ref(3) === "W") lng = -lng;
    return { lat, lng };
  } catch { return null; }
}
const km = (a, b) => { const R = 6371, r = (x) => (x * Math.PI) / 180; const d = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(d)); };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const csv = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;

const listings = await db.listing.findMany({ where: { status: { not: "removed" } }, include: { photos: { orderBy: { sort: "asc" } } }, orderBy: { id: "asc" } });
const rows = [["code", "title", "pin lat", "pin lng", "photo", "cover", "photo lat", "photo lng", "metres from pin"].map(csv).join(",")];
const sum = [["code", "title", "pin lat", "pin lng", "photos", "photos with GPS", "suggested lat", "suggested lng", "pin to suggested (m)", "verdict"].map(csv).join(",")];
let withPin = 0, photos = 0, withGps = 0, listingsWithGps = 0, far = 0, noPin = 0;
for (const l of listings) {
  const pin = l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null;
  if (pin) withPin++;
  const found = [];
  for (const [i, p] of l.photos.entries()) {
    photos++;
    const path = [join(media, "property", "original", p.file), join(media, "property", "main", p.file)].find((x) => existsSync(x));
    const g = path ? gpsOf((await sharp(readFileSync(path)).metadata().catch(() => ({}))).exif) : null;
    if (g) { withGps++; found.push(g); }
    rows.push([l.code, l.title, pin?.lat, pin?.lng, p.file, i === 0 ? "yes" : "", g?.lat?.toFixed(6), g?.lng?.toFixed(6), g && pin ? Math.round(km(pin, g) * 1000) : ""].map(csv).join(","));
  }
  if (!found.length) continue;
  listingsWithGps++;
  const s = { lat: median(found.map((x) => x.lat)), lng: median(found.map((x) => x.lng)) };
  const d = pin ? Math.round(km(pin, s) * 1000) : null;
  const verdict = !pin ? "no pin: use suggested" : d > 1000 ? "pin far from photos" : d > 300 ? "pin roughly right" : "pin matches photos";
  if (!pin) noPin++; else if (d > 1000) far++;
  sum.push([l.code, l.title, pin?.lat, pin?.lng, l.photos.length, found.length, s.lat.toFixed(6), s.lng.toFixed(6), d ?? "", verdict].map(csv).join(","));
}
writeFileSync("photo-gps-report.csv", "\uFEFF" + rows.join("\r\n"));
writeFileSync("photo-gps-summary.csv", "\uFEFF" + sum.join("\r\n"));
console.log(`${listings.length} listings: ${withPin} have a pin.`);
console.log(`${photos} photos: ${withGps} still carry GPS, on ${listingsWithGps} listings.`);
console.log(`Of those: ${noPin} have no pin yet, ${far} have a pin more than 1 km from their photos.`);
console.log("Reports: backend-core/photo-gps-summary.csv (one line per listing) and photo-gps-report.csv (every photo).");
await db.$disconnect();
