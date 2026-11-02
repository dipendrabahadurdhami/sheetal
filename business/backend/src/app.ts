import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";

// Business API: the business panel (/business): listings, leads, bookings, team and settings for one workspace.
// Shared basics come from backend-core; this panel's routes are added here as each phase is built.
export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  return buildBaseApp(config, deps);
}
