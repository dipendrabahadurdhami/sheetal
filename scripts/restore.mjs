// Puts a database backup (from `npm run backup`) back.
//   npm run restore                          lists the backups
//   npm run restore -- 2026-11-04_0930 --yes  replaces ALL current data with that backup
// The tables must already exist at the same version (npm run db:local, then the migrations: npx prisma migrate deploy
// in backend-core). Then every table is emptied and refilled from the backup's files in one transaction (all or
// nothing), id counters move past the restored rows, and the row counts are checked against the backup. Photos: copy PHOTOS_BACKUP_DIR back into MEDIA_DIR by hand.
// Set RESTORE_DATABASE_URL to restore into another database (e.g. a spare one) instead of DATABASE_URL.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
const env = { ...readEnv(join(root, "backend-core", ".env")), ...process.env };
const backupDir = resolve(env.BACKUP_DIR || (env.OneDrive && existsSync(env.OneDrive) ? join(env.OneDrive, "Sheetal-Backups") : join(homedir(), "Sheetal-Backups")));
const dbDir = join(backupDir, "database");
const which = process.argv.slice(2).find((a) => !a.startsWith("--"));
const sure = process.argv.includes("--yes");

const list = existsSync(dbDir) ? readdirSync(dbDir).filter((d) => existsSync(join(dbDir, d, "manifest.json"))).sort() : [];
if (!which) {
  console.log(list.length ? `Backups in ${dbDir}:\n${list.map((d) => `  ${d}`).join("\n")}\n\nRestore one with: npm run restore -- <name> --yes` : `No backups in ${dbDir}.`);
  process.exit(0);
}
const from = join(dbDir, which);
if (!existsSync(join(from, "manifest.json"))) fail(`No backup called ${which} in ${dbDir}.`);
const manifest = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"));
const url = env.RESTORE_DATABASE_URL || env.DATABASE_URL;
if (!url) fail("DATABASE_URL isn't set in backend-core/.env.");
if (!sure) fail(`This replaces ALL data in ${url.replace(/:[^:@/]+@/, ":****@")} with the backup from ${manifest.createdAt}.\nRun again with --yes to go ahead.`);

const db = new pg.Client({ connectionString: url });
try { await db.connect(); } catch { fail("Can't reach the database. Start it first: npm run db:local"); }
const have = new Set((await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name));
const tables = Object.keys(manifest.tables).filter((t) => t !== "_prisma_migrations");
const missing = tables.filter((t) => !have.has(t));
if (missing.length) fail(`These tables don't exist here yet: ${missing.join(", ")}. Run the migrations first (backup made at ${manifest.lastMigration}).`);

await db.query("BEGIN");
try {
  // Links between tables aren't checked while loading (the backup came from a consistent database, in any table order).
  await db.query("SET session_replication_role = replica");
  await db.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
  for (const t of tables) {
    const file = join(from, `${t}.csv`).replace(/\\/g, "/");
    await db.query(`COPY "${t}" FROM '${file.replace(/'/g, "''")}' WITH (FORMAT csv, HEADER, ENCODING 'UTF8')`);
  }
  await db.query("SET session_replication_role = DEFAULT");
  // Id counters (serial columns) continue after the restored rows.
  const seqs = (await db.query(`SELECT c.table_name, c.column_name, pg_get_serial_sequence(format('%I', c.table_name), c.column_name) AS seq
    FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.column_default LIKE 'nextval(%'`)).rows;
  for (const s of seqs) if (s.seq) await db.query(`SELECT setval('${s.seq}', COALESCE((SELECT max("${s.column_name}") FROM "${s.table_name}"), 0) + 1, false)`);
  await db.query("COMMIT");
} catch (e) {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
  fail(`Restore stopped; nothing was changed. ${e.message}`);
}
const counts = {};
for (const t of tables) counts[t] = Number((await db.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
await db.end();
const off = tables.filter((t) => counts[t] !== manifest.tables[t]);
if (off.length) fail(`Row counts differ from the backup for: ${off.join(", ")}`);
console.log(`Restored ${tables.length} tables (${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString("en-IN")} rows) from ${which}. All row counts match the backup.`);

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")]; }));
}
function fail(msg) { console.error(msg); process.exit(1); }
