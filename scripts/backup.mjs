// Backup of what git doesn't hold: the database and the photos/documents in MEDIA_DIR.
//   npm run backup                  database + photos
//   npm run backup -- --no-photos   database only
// Where (set in backend-core/.env, or leave the defaults):
//   BACKUP_DIR         database exports, one dated folder each (default: OneDrive\Sheetal-Backups, else ~\Sheetal-Backups)
//   PHOTOS_BACKUP_DIR  copy of MEDIA_DIR; only new or changed files are copied after the first run
//                      (default: ~\Sheetal-Backups\photos; point it at a USB drive for a copy off this computer)
//   BACKUP_KEEP        how many database exports to keep (default 30)
// The database is exported table by table by the database server itself (COPY, CSV), so every value comes back exactly
// with `npm run restore`. The database must be running (npm run db:local).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...readEnv(join(root, "backend-core", ".env")), ...process.env };
const noPhotos = process.argv.includes("--no-photos");

const backupDir = resolve(env.BACKUP_DIR || (env.OneDrive && existsSync(env.OneDrive) ? join(env.OneDrive, "Sheetal-Backups") : join(homedir(), "Sheetal-Backups")));
const photosDir = resolve(env.PHOTOS_BACKUP_DIR || join(homedir(), "Sheetal-Backups", "photos"));
const keep = Math.max(1, Number(env.BACKUP_KEEP) || 30);

if (!env.DATABASE_URL) fail("DATABASE_URL isn't set in backend-core/.env.");

// ───── Database ─────
// Named by this computer's local date and time, e.g. 2026-11-04_1013.
const now = new Date();
const two = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}`;
const out = join(backupDir, "database", stamp);
mkdirSync(out, { recursive: true });
const db = new pg.Client({ connectionString: env.DATABASE_URL });
try { await db.connect(); } catch { fail("Can't reach the database. Start it first: npm run db:local"); }
const tables = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")).rows.map((r) => r.table_name);
const counts = {};
for (const t of tables) {
  // The server writes the file itself (it runs on this computer); forward slashes work on Windows too.
  const file = join(out, `${t}.csv`).replace(/\\/g, "/");
  await db.query(`COPY "${t}" TO '${file.replace(/'/g, "''")}' WITH (FORMAT csv, HEADER, ENCODING 'UTF8')`);
  counts[t] = Number((await db.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
}
const lastMigration = (await db.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`).catch(() => ({ rows: [] }))).rows[0]?.migration_name ?? null;
await db.end();
writeFileSync(join(out, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), lastMigration, tables: counts }, null, 2));
const size = readdirSync(out).reduce((s, f) => s + statSync(join(out, f)).size, 0);
console.log(`Database: ${tables.length} tables, ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString("en-IN")} rows, ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  saved in ${out}`);

// Keep the newest exports only.
const all = readdirSync(join(backupDir, "database")).filter((d) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d)).sort();
for (const old of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(backupDir, "database", old), { recursive: true, force: true });
if (all.length > keep) console.log(`  removed ${all.length - keep} older export(s); keeping the newest ${keep}`);

// ───── Photos and documents ─────
if (noPhotos) {
  console.log("Photos: skipped (--no-photos).");
} else if (!env.MEDIA_DIR || !existsSync(env.MEDIA_DIR)) {
  console.log("Photos: MEDIA_DIR isn't set or doesn't exist; nothing to copy.");
} else {
  mkdirSync(photosDir, { recursive: true });
  console.log(`Photos: copying new or changed files from ${env.MEDIA_DIR}`);
  console.log(`  to ${photosDir} (the first run takes a while)…`);
  // Robocopy: copy new and changed files, never delete from the backup; exit codes below 8 mean success.
  const r = spawnSync("robocopy", [env.MEDIA_DIR, photosDir, "/E", "/XO", "/R:1", "/W:1", "/NFL", "/NDL", "/NP", "/NJH"], { encoding: "utf8" });
  if (r.error || r.status >= 8) fail(`Copying photos failed (robocopy ${r.status ?? r.error?.message}).`);
  const summary = (r.stdout || "").split(/\r?\n/).filter((l) => /^\s*(Files|Bytes)\s*:/.test(l)).map((l) => l.trim());
  for (const l of summary) console.log(`  ${l}`);
}
console.log("Backup done.");

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")]; }));
}
function fail(msg) { console.error(msg); process.exit(1); }
