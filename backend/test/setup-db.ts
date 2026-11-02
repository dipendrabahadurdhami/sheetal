import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

// Throwaway PostgreSQL for the test run: started once, migrated, deleted at the end.
const PORT = 5434;

declare module "vitest" {
  export interface ProvidedContext { databaseUrl: string }
}

export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), "sheetal-test-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "test", password: "test", port: PORT, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("sheetal_test");
  const url = `postgresql://test:test@localhost:${PORT}/sheetal_test`;
  execSync("npx prisma migrate deploy", { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  project.provide("databaseUrl", url);
  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
