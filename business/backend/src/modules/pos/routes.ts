// Point of sale: moved to the POS app (apps/pos/backend) in P2-W4; registered there by posRoutes together with Stock. This file keeps the old name.
// Rules: no new code imports this path; it is deleted at the end of Phase 2. It registers nothing, so no route is registered twice.
import type { FastifyInstance } from "fastify";
export { billCode } from "@sheetal/app-pos/backend";
export async function posRoutes(_app: FastifyInstance) { /* moved: see apps/pos/backend */ }
