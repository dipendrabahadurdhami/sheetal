// Projects routes: the code moved in P2-W3 to the Projects app (units, holds, reservations and their payments: apps/projects/backend) and the Investments app
// (pledges and updates: apps/investments/backend). This file keeps the old name so nothing that imports it changes; app.ts registers both apps directly.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";
import { projectRoutes as projects } from "@sheetal/app-projects/backend";
import { investmentRoutes } from "@sheetal/app-investments/backend";
import { businessContextOf } from "../access.js";

export async function projectRoutes(app: FastifyInstance) {
  await projects(app, { contextOf: businessContextOf });
  await investmentRoutes(app, { contextOf: businessContextOf });
}
