// Hotel routes: the code moved to the Hotel app (apps/hotel/backend) in P2-W4; this file keeps the old names so nothing that imports them changes.
// Rules: no new code imports this path; it is deleted at the end of Phase 2. app.ts registers hotelRoutes from "@sheetal/app-hotel/backend" directly.

import type { FastifyInstance } from "fastify";
import { hotelRoutes as routes } from "@sheetal/app-hotel/backend";
import { businessContextOf } from "../access.js";

export { bookingCode, folioOf } from "@sheetal/app-hotel/backend";
export const hotelRoutes = (app: FastifyInstance) => routes(app, { contextOf: businessContextOf });
