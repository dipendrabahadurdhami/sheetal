// `npm run integrations:migrate`: copies today's connection settings into the Integration Center (INTEGRATIONS.md section 9.1).
// What it reads: the settings rows "payments" (eSewa, Khalti, Fonepay) and "integration.google", "integration.whatsapp", "integration.cloudflare".
// What it writes: one platform connection for each that has something saved. Sealed keys are copied as they are; they are never opened.
// Safe to run again: a connection that already exists is left alone. It deletes nothing: the old rows stay and keep working.
// Usage: npm run integrations:migrate            (prints a report: created, skipped and why)
import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { importLegacy } from "@sheetal/platform/integrations/legacy";

loadEnvFiles();
const config = loadConfig(process.env, "admin");
const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });

try {
  const report = await importLegacy(db);
  for (const r of report) console.log(`${r.result.padEnd(9)} ${r.id.padEnd(11)} ${r.why}`);
  const made = report.filter((r) => r.result === "created").length;
  console.log(`\nDone: ${made} connection(s) created, ${report.length - made} left as they were. Nothing was deleted.`);
} catch (err) {
  console.error(`integrations:migrate failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
