import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- pg ships without type definitions in this repo (embedded-postgres brings it); only Client is used.
import pg from "pg";
import type { TestProject } from "vitest/node";

// Test database on the already-running local database (npm run db:local, port 5433) instead of a new embedded one.
// For PCs where Windows blocks creating a new embedded PostgreSQL (Application Control blocks a file initdb needs).
// Use it with: npx vitest run --config vitest.local-db.config.ts (in a backend folder). A fresh "sheetal_test_<n>" database
// is made for the run and dropped at the end; the real local data in "sheetal" is never touched.

export default async function setup(project: TestProject) {
  const port = Number(process.env.LOCAL_DB_PORT || 5433);
  const name = `sheetal_test_${process.pid}`;
  const admin = new pg.Client({ connectionString: `postgresql://sheetal:sheetal_local@localhost:${port}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await admin.end();
  const url = `postgresql://sheetal:sheetal_local@localhost:${port}/${name}`;
  execSync("npx prisma migrate deploy", { cwd: fileURLToPath(new URL("../../backend-core", import.meta.url)), env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  project.provide("databaseUrl", url);
  return async () => {
    const c = new pg.Client({ connectionString: `postgresql://sheetal:sheetal_local@localhost:${port}/postgres` });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.end();
  };
}
