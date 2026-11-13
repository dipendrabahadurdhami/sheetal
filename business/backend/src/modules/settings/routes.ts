// Business settings and listing check-ups: the routes moved to the Workspace app (apps/workspace/backend, registered by workspaceRoutes) in P2-W5/W6.
// This file keeps the old names: settingsRoutes registers nothing (so no route is registered twice).
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";

export { SECTIONS, MASK, CHECKUP_DEFAULTS } from "@sheetal/app-workspace/backend";
export async function settingsRoutes(_app: FastifyInstance) { /* moved: see apps/workspace/backend */ }
