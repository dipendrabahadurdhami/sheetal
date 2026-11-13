// Leads (the Inbox): the code moved to the CRM app (apps/crm/backend) in P2-W5; this file keeps the old name so nothing that imports it changes.
// Rules: no new code imports this path; it is deleted at the end of Phase 2. app.ts registers leadRoutes from "@sheetal/app-crm/backend" directly.

import type { FastifyInstance } from "fastify";
import { leadRoutes as routes } from "@sheetal/app-crm/backend";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { businessContextOf } from "../access.js";

export const leadRoutes = (app: FastifyInstance, opts: { fetch?: Fetch } = {}) => routes(app, { contextOf: businessContextOf, fetch: opts.fetch });
