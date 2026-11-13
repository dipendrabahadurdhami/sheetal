// Projects (developers): project units, holds, reservations and their payments, on the kernel since P2-W3.
// Where it fits: business/backend/src/app.ts registers projectRoutes with { prefix: "/v1", contextOf: businessContextOf }. The Investments routes that shared
// the old file are in apps/investments/backend. The old route file business/backend/src/modules/projects/routes.ts is a shim over both.
// How it works: the context is capped at "branch" (PHASE_ONE_CAPS), so people keep today's view. Split by job: repositories.ts, project.service.ts,
// project.controller.ts, presenter.ts.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "@sheetal/platform/core/host";
import { capContext } from "@sheetal/platform/core/scope-cap";
import { ProjectController } from "./project.controller.js";
import { ProjectService } from "./project.service.js";

export interface ProjectRoutesOptions { contextOf: (req: FastifyRequest) => Promise<BusinessContext> }

export async function projectRoutes(app: FastifyInstance, opts: ProjectRoutesOptions) {
  new ProjectController(new ProjectService({ bus: busOf(app, "projects") }), async (req) => capContext(await opts.contextOf(req), "projects")).register(app);
}
