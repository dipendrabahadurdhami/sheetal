// Payouts: the business side moved to the Invoicing app (apps/invoicing/backend/payouts.ts) in P2-W3 and is registered by invoicingRoutes.
// Rules: no new code imports this path; it is deleted at the end of Phase 2. It registers nothing, so the routes are never registered twice.

import type { FastifyInstance } from "fastify";

export async function payoutRoutes(_app: FastifyInstance) { /* moved: see apps/invoicing/backend/payouts.ts */ }
