import type { FastifyInstance } from "fastify";
import type { Config } from "@sheetal/backend-core/config";
import { buildBaseApp, type AppDeps } from "@sheetal/backend-core/app";

// Admin API: the admin panel (/admin): Sheetal staff managing businesses, plans, moderation and settings.
// Shared basics come from backend-core; this panel's routes are added here as each phase is built.
export async function buildApp(config: Config, deps: AppDeps = {}): Promise<FastifyInstance> {
  return buildBaseApp(config, deps);
}
