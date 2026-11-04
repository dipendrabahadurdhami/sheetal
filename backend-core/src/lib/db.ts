// Database connection (Prisma) and the dbOf() helper routes use.
// Where it fits: app.db in every API.
// How it works: created only when DATABASE_URL is set, so an API can still start during first setup and report
// "database not configured"; dbOf() turns that case into a clear 503.

import { PrismaClient } from "@prisma/client";
import { AppError } from "./errors.js";

export type Db = PrismaClient;

export function createDb(databaseUrl?: string, logQueries = false): Db | undefined {
  if (!databaseUrl) return undefined;
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: logQueries ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

export async function pingDb(db?: Db): Promise<boolean> {
  if (!db) return false;
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** The database for a route; a friendly 503 while it isn't configured or reachable. */
export function dbOf(app: { db?: Db }): Db {
  if (!app.db) throw new AppError(503, "unavailable", "The service is starting up. Please try again in a minute.");
  return app.db;
}
