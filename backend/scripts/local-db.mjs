// Local PostgreSQL for development, with no system install: `npm run db:local` (keep it running).
// Data lives in backend/.pgdata (git-ignored). Production uses a normal PostgreSQL server instead.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../.pgdata", import.meta.url));
const port = Number(process.env.LOCAL_DB_PORT || 5433);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "sheetal", password: "sheetal_local", port, persistent: true });

if (!existsSync(`${dir}/PG_VERSION`)) {
  console.log("Creating the local database (first run only)…");
  await pg.initialise();
}
await pg.start();
try { await pg.createDatabase("sheetal"); } catch { /* already exists */ }

console.log(`Local PostgreSQL is running on port ${port}.`);
console.log(`DATABASE_URL=postgresql://sheetal:sheetal_local@localhost:${port}/sheetal`);
console.log("Press Ctrl+C to stop.");

const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
