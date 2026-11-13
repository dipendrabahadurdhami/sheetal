// Selling on other sites: moved to the Hotel app (apps/hotel/backend, ota.*) in P2-W6.
// This file keeps the old name: otaRoutes registers nothing (so no route is registered twice). Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";

export async function otaRoutes(_app: FastifyInstance, _opts?: unknown) { /* moved */ }
