// Branches: the routes moved to the Workspace app (apps/workspace/backend, registered by workspaceRoutes) in P2-W5/W6. This file keeps the old names:
// branchRoutes registers nothing (so no route is registered twice), and checkScopes() is unchanged.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";
import { dbOf } from "@sheetal/platform/db/client";
import { resolveBranchAccess } from "@sheetal/platform/tenancy/branch-links";

export async function branchRoutes(_app: FastifyInstance) { /* moved: see apps/workspace/backend */ }

/** Branch access must name real, open branches of the business (or be "all"). Returns the NAMES, as before (the team routes now use resolveBranchAccess). */
export async function checkScopes(app: FastifyInstance, tenantId: string, scopes: "all" | string[] | undefined) {
  const access = await resolveBranchAccess(dbOf(app), tenantId, { scopes });
  if (!access) return scopes;
  return access.all ? "all" : access.names;
}
