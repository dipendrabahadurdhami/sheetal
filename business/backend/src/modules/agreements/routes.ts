// Agreements routes: the code moved to the Agreements app (apps/agreements/backend) in P2-W1 stage 3; this file keeps the old name so nothing that imports it changes.
// Where it fits: app.ts imports agreementRoutes from "@sheetal/app-agreements/backend" directly; this shim is for any old import.
// Rules: no new code imports this path; it is deleted at the end of Phase 2.

import type { FastifyInstance } from "fastify";
import { agreementRoutes as routes } from "@sheetal/app-agreements/backend";
import { businessContextOf } from "../access.js";

export const agreementRoutes = (app: FastifyInstance) => routes(app, { contextOf: businessContextOf });
