// Import and export: the routes moved to the Workspace app (apps/workspace/backend, registered by workspaceRoutes) in P2-W6
// (Workspace part 2). This file keeps the old name: dataRoutes registers nothing (so no route is registered twice).
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";

export async function dataRoutes(_app: FastifyInstance) { /* moved: see apps/workspace/backend */ }
