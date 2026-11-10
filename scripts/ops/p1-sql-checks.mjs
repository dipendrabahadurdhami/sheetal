// Phase 1, step 1: the database spot checks from CHANGES-P1-DB-1.md (every number must be 0).
// Run by p1-step1.ps1 after the migration. Prints one line per check and exits 1 if any is not 0.
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// DATABASE_URL lives in .env (repo root or backend-core); read it if the shell does not have it.
if (!process.env.DATABASE_URL) {
  for (const f of [join(repo, "backend-core", ".env"), join(repo, ".env")]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) { process.env.DATABASE_URL = m[1]; break; }
  }
}

const require = createRequire(join(repo, "backend-core", "package.json"));
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const checks = [
  ["expenses: paisa empty or wrong", `SELECT count(*) AS n FROM expenses WHERE amount_paisa IS DISTINCT FROM amount::bigint * 100`],
  ["recurring expenses: paisa empty or wrong", `SELECT count(*) AS n FROM recurring_expenses WHERE amount_paisa IS DISTINCT FROM amount::bigint * 100`],
  ["expenses: version not 1 or deleted", `SELECT count(*) AS n FROM expenses WHERE version <> 1 OR deleted_at IS NOT NULL`],
  ["recurring expenses: version not 1 or deleted", `SELECT count(*) AS n FROM recurring_expenses WHERE version <> 1 OR deleted_at IS NOT NULL`],
  ["reviews: version not 1 or deleted", `SELECT count(*) AS n FROM reviews WHERE version <> 1 OR deleted_at IS NOT NULL`],
  ["demo businesses", `SELECT count(*) AS n FROM tenants WHERE demo`],
  ["event outbox rows", `SELECT count(*) AS n FROM event_outbox`],
  ["event delivery rows", `SELECT count(*) AS n FROM event_deliveries`],
];

let bad = 0;
try {
  for (const [label, sql] of checks) {
    const [row] = await db.$queryRawUnsafe(sql);
    const n = Number(row.n);
    if (n !== 0) bad++;
    console.log(`${n === 0 ? "PASS" : "FAIL"}  ${label}: ${n}`);
  }
} catch (e) {
  console.log(`ERROR  ${e.message}`);
  bad++;
} finally {
  await db.$disconnect();
}
process.exit(bad ? 1 : 0);
