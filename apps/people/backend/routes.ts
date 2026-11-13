// People: attendance and leave (Business → Team → Attendance, /business/people), on the kernel since P2-W1 stage 2.
// Where it fits: business/backend/src/app.ts registers peopleRoutes with { prefix: "/v1", contextOf: businessContextOf }; business/backend/src/modules/people/routes.ts
// is a one-line shim over this file. The code is split by job: repositories.ts (tables), people.service.ts (rules), people.controller.ts (HTTP), time.ts (days).
// How it works: the context is capped at "branch" for People (scope.ts), so everyone keeps today's view: the branch picked at the top, or all of theirs.
// The approval gate is the one the business API decorates (app.approvals); without it nothing is ever held.
// Rules: see people.service.ts.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { PeopleController } from "./people.controller.js";
import { PeopleService, type PeopleServiceDeps } from "./people.service.js";
import { phaseOneContext } from "./scope.js";

export interface PeopleRoutesOptions {
  /** Builds the context of a request (business/backend/src/modules/access.ts businessContextOf). Passed in because an app does not import an API. */
  contextOf: (req: FastifyRequest) => Promise<BusinessContext>;
}

export async function peopleRoutes(app: FastifyInstance, opts: PeopleRoutesOptions) {
  const service = new PeopleService({
    bus: busOf(app, "people"),
    approvals: (app as unknown as { approvals?: PeopleServiceDeps["approvals"] }).approvals,
    wrap: phaseOneContext,
  });
  new PeopleController(service, async (req) => phaseOneContext(await opts.contextOf(req))).register(app);
}
