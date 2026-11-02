// Local PostgreSQL for development, with no system install: `npm run db:local` (keep it running).
// Data lives in backend-core/.pgdata (git-ignored). Production uses a normal PostgreSQL server instead.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../.pgdata", import.meta.url));
const port = Number(process.env.LOCAL_DB_PORT || 5433);
// Always UTF-8: listings contain Nepali text and emojis, which Windows' default character set can't hold.
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "sheetal", password: "sheetal_local", port, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
const recreate = process.argv.includes("--recreate");

// Already running (another terminal, or a crashed run that left it up)? Then there is nothing to do.
const probe = pg.getPgClient("postgres");
let running = false;
try { await probe.connect(); await probe.end(); running = true; } catch { /* not running yet: start it below */ }

if (running) {
  console.log(`The local database is already running on port ${port}. Nothing to do; it keeps running.`);
} else {
  if (!existsSync(`${dir}/PG_VERSION`)) {
    console.log("Creating the local database (first run only)…");
    await pg.initialise();
  }
  await pg.start();

  const admin = pg.getPgClient("postgres");
  await admin.connect();
  const found = (await admin.query("SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = 'sheetal'")).rows[0];
  if (found && found.enc !== "UTF8" && !recreate) {
    console.warn(`The local database uses ${found.enc}, which can't store Nepali text or emojis.`);
    console.warn("Run `npm run db:local -w @sheetal/backend-core -- --recreate` once to rebuild it as UTF-8 (local data is cleared; then migrate, seed and import again).");
  }
  if (found && recreate) {
    console.log("Recreating the local database as UTF-8…");
    await admin.query("DROP DATABASE sheetal WITH (FORCE)");
  }
  if (!found || recreate) await admin.query("CREATE DATABASE sheetal TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'");
  await admin.end();

  console.log(`Local PostgreSQL is running on port ${port}.`);
  console.log(`DATABASE_URL=postgresql://sheetal:sheetal_local@localhost:${port}/sheetal`);
  console.log("Press Ctrl+C to stop.");

  const stop = async () => { await pg.stop(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
