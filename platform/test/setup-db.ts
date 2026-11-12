import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

// Throwaway PostgreSQL for the test run: started once, migrated, deleted at the end.
// Each run takes a free port, so the core and website test runs never collide.
const freePort = () => new Promise<number>((resolve, reject) => {
  const srv = createServer().once("error", reject).listen(0, () => {
    const { port } = srv.address() as { port: number };
    srv.close(() => resolve(port));
  });
});

declare module "vitest" {
  export interface ProvidedContext { databaseUrl: string }
}

export default async function setup(project: TestProject) {
  const PORT = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "sheetal-test-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "test", password: "test", port: PORT, persistent: true, onLog: () => {}, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
  await pg.initialise();
  await pg.start();
  // UTF-8 like production, so tests catch text that a Windows character set would reject.
  const admin = pg.getPgClient("postgres");
  await admin.connect();
  await admin.query("CREATE DATABASE sheetal_test TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'");
  await admin.end();
  const url = `postgresql://test:test@localhost:${PORT}/sheetal_test`;
  execSync("npx prisma migrate deploy", { cwd: fileURLToPath(new URL("../../backend-core", import.meta.url)), env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  project.provide("databaseUrl", url);
  return async () => {
    await pg.stop();
    // Windows can hold the folder for a moment after Postgres stops; a leftover temp folder is harmless.
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* ignore */ }
  };
}
