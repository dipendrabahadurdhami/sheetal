// Listings: the code moved to the Listings app (apps/listings/backend) in P2-W5; this file keeps the old name so nothing that imports it changes.
// Rules: no new code imports this path; it is deleted at the end of Phase 2. app.ts registers listingRoutes from "@sheetal/app-listings/backend" directly.

import type { FastifyInstance } from "fastify";
import { listingRoutes as routes } from "@sheetal/app-listings/backend";
import { businessContextOf } from "../access.js";

export const listingRoutes = (app: FastifyInstance) => routes(app, { contextOf: businessContextOf });
