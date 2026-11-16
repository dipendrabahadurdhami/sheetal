// A scratch copy of the database, to try risky steps on before they touch the real data (PHASE-3-TASKS.md, task P3-OPS-1; launch gate G8).
//   npm run scratch -- make                 a fresh copy from the newest backup (npm run backup makes one)
//   npm run scratch -- make 2026-11-16_0930 the same from a named backup
//   npm run scratch -- run <command…>       runs a command against the copy, e.g. npm run scratch -- run npm run billing:migrate
//   npm run scratch -- drop                 removes the copy
// Where it fits: the Phase 3 dry run and the cutover rehearsal (scripts/ops/p3-step1.ps1, p3-step2.ps1) run every step on the copy first.
// How it works: the copy is a second database, `sheetal_scratch`, on the same local PostgreSQL server as DATABASE_URL (backend-core/.env).
// `make` drops and re-creates it, builds the tables with the migrations (prisma migrate deploy) and fills them with scripts/restore.mjs
// (RESTORE_DATABASE_URL), which checks every row count against the backup. `run` starts the command with DATABASE_URL pointing at the copy:
// our scripts and Prisma both let the shell's value win over the .env file, so nothing in that command can reach the real database.
// Rules: the real database is only ever read (by the backup). The copy's name is fixed; this script refuses to work if DATABASE_URL itself
// names the copy, and it never prints a database address (it can carry the password). The backup must be as new as the code's migrations.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCRATCH_NAME = "sheetal_scratch";

/** The copy's address: the same server and login as `url`, the database `sheetal_scratch`. Throws when `url` already names the copy. */
export function scratchUrl(url) {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("DATABASE_URL is not a PostgreSQL address.");
  const name = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!name) throw new Error("DATABASE_URL names no database.");
  if (name === SCRATCH_NAME) throw new Error(`DATABASE_URL already points at ${SCRATCH_NAME}: the real database and the copy must differ.`);
  u.pathname = `/${SCRATCH_NAME}`;
  return u.toString();
}

/** The server's own maintenance database (to create and drop the copy from). */
export function adminUrl(url) {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

/** Quotes one argument for a shell command line (cmd and sh both take double quotes). */
export const quoteArg = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

const hide = (s) => String(s).replace(/postgres(ql)?:\/\/\S+/g, "[database address hidden]");
function fail(msg) { console.error(hide(msg)); process.exit(1); }
function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")]; }));
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  // The real address always comes from the file, never from the shell: inside `run` the shell's value is the copy.
  const fileEnv = readEnv(join(root, "backend-core", ".env"));
  const env = { ...fileEnv, ...process.env, DATABASE_URL: fileEnv.DATABASE_URL };
  if (!env.DATABASE_URL) fail("DATABASE_URL isn't set in backend-core/.env.");
  let scratch;
  try { scratch = scratchUrl(env.DATABASE_URL); } catch (e) { fail(e.message); }
  const [command, ...rest] = process.argv.slice(2);
  const { default: pg } = await import("pg");

  const admin = async (fn) => {
    const c = new pg.Client({ connectionString: adminUrl(env.DATABASE_URL) });
    try { await c.connect(); } catch { fail("Can't reach the database server. Start it first: npm run db:local"); }
    try { return await fn(c); } finally { await c.end(); }
  };
  const exists = () => admin(async (c) => (await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [SCRATCH_NAME])).rowCount > 0);
  // One command line through the shell (npm and npx are .cmd files on Windows), with DATABASE_URL = the copy.
  const sh = (line, extra = {}) => spawnSync(line, { cwd: root, shell: true, stdio: "inherit", env: { ...process.env, DATABASE_URL: scratch, ...extra } }).status ?? 1;

  if (command === "make") {
    const backupDir = resolve(env.BACKUP_DIR || (env.OneDrive && existsSync(env.OneDrive) ? join(env.OneDrive, "Sheetal-Backups") : join(homedir(), "Sheetal-Backups")));
    const dbDir = join(backupDir, "database");
    const list = existsSync(dbDir) ? readdirSync(dbDir).filter((d) => existsSync(join(dbDir, d, "manifest.json"))).sort() : [];
    const which = rest.find((a) => !a.startsWith("--")) ?? list.at(-1);
    if (!which || !list.includes(which)) fail(which ? `No backup called ${which} in ${dbDir}.` : `No backups in ${dbDir}. Make one first: npm run backup -- --no-photos`);
    const manifest = JSON.parse(readFileSync(join(dbDir, which, "manifest.json"), "utf8"));
    const newest = readdirSync(join(root, "backend-core", "prisma", "migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().at(-1);
    if (manifest.lastMigration !== newest) fail(`The backup ${which} was made at migration ${manifest.lastMigration}; the code is at ${newest}.\nMake a fresh backup first: npm run backup -- --no-photos`);
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${SCRATCH_NAME}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${SCRATCH_NAME}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
    });
    console.log(`Scratch copy: empty database ${SCRATCH_NAME} created. Building the tables…`);
    if (sh("npx prisma migrate deploy --schema backend-core/prisma/schema.prisma")) fail("The migrations did not apply to the scratch copy.");
    console.log(`Scratch copy: filling it from the backup ${which}…`);
    if (sh(`node scripts/restore.mjs ${quoteArg(which)} --yes`, { RESTORE_DATABASE_URL: scratch })) fail("The backup could not be restored into the scratch copy.");
    console.log(`Scratch copy ready: ${SCRATCH_NAME}, from the backup ${which}. The real database was not changed.`);
    return 0;
  }
  if (command === "run") {
    if (!rest.length) fail("Say what to run: npm run scratch -- run npm run billing:migrate");
    if (!(await exists())) fail("There is no scratch copy yet. Make it first: npm run scratch -- make");
    return sh(rest.map(quoteArg).join(" "));
  }
  if (command === "drop") {
    await admin((c) => c.query(`DROP DATABASE IF EXISTS "${SCRATCH_NAME}" WITH (FORCE)`));
    console.log(`Scratch copy removed (${SCRATCH_NAME}).`);
    return 0;
  }
  console.log("Use: npm run scratch -- make [backup name]  |  npm run scratch -- run <command…>  |  npm run scratch -- drop");
  return command ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch((e) => fail(e.stack ?? e.message));
}
