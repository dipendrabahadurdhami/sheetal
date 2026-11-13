// Growth tools: moved in P2-W6 (analytics, channels, AI meter → apps/workspace/backend; lead finder, Meta webhook → apps/crm/backend;
// calendar feeds and the iCal link → apps/hotel/backend).
// This file keeps the old name: growthRoutes registers nothing (so no route is registered twice). Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";

export async function growthRoutes(_app: FastifyInstance, _opts?: unknown) { /* moved */ }
