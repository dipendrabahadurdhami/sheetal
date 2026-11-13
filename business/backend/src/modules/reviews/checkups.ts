// Listing check-ups: moved to the Listings app (apps/listings/backend, checkup.*) in P2-W6. This file keeps the old names: reviewRoutes registers nothing
// (so no route is registered twice); reviewCheckupJob, decideChanges, GROUPS and nepalDay are re-exported.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";
export { checkupJob as reviewCheckupJob } from "@sheetal/app-listings/backend/checkup.job";
export { decideChanges, GROUPS, nepalDay } from "@sheetal/app-listings/backend/checkup.service";

export async function reviewRoutes(_app: FastifyInstance) { /* moved: see apps/listings/backend */ }
