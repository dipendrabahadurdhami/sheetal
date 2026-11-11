// Rentals routes: the code moved to the Rentals app (apps/rentals/backend) in P2-W1-S1; this file keeps the old names so nothing that imports it changes.
// Where it fits: business/backend/src/jobs.ts (rentJob) and tests (startRentJob) import it. app.ts imports rentalRoutes from "@sheetal/app-rentals/backend" directly.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";
import { rentalRoutes as routes } from "@sheetal/app-rentals/backend";
import { businessContextOf } from "../access.js";

export { rentJob, startRentJob } from "@sheetal/app-rentals/backend";
export const rentalRoutes = (app: FastifyInstance) => routes(app, { contextOf: businessContextOf });
