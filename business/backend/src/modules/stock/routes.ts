// Stock: moved to the POS app (apps/pos/backend) in P2-W4; its routes are registered by posRoutes and its low-stock job is apps/pos/backend/jobs.ts.
// This file keeps the old names. Rules: no new code imports this path; it is deleted at the end of Phase 2. It registers nothing.
import type { FastifyInstance } from "fastify";
export { stockJob, startStockJob } from "@sheetal/app-pos/backend";
export async function stockRoutes(_app: FastifyInstance) { /* moved: see apps/pos/backend */ }
