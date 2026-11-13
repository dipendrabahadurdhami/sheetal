// Customer invoices: the code moved to the Invoicing app (apps/invoicing/backend) in P2-W3; this file keeps the old name so nothing that imports it changes.
// Rules: no new code imports this path; it is deleted at the end of Phase 2. app.ts registers invoicingRoutes from "@sheetal/app-invoicing/backend" directly.

import type { FastifyInstance } from "fastify";
import { invoicingRoutes as routes } from "@sheetal/app-invoicing/backend";
import { businessContextOf } from "../access.js";

export { METHODS } from "@sheetal/app-invoicing/backend";
export const invoicingRoutes = (app: FastifyInstance) => routes(app, { contextOf: businessContextOf });
