// People routes: the code moved to the People app (apps/people/backend) in P2-W1 stage 2; this file keeps the old name so nothing that imports it changes.
// Where it fits: app.ts imports peopleRoutes from "@sheetal/app-people/backend" directly; this shim is for any old import.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";
import { peopleRoutes as routes } from "@sheetal/app-people/backend";
import { businessContextOf } from "../access.js";

export const peopleRoutes = (app: FastifyInstance) => routes(app, { contextOf: businessContextOf });
