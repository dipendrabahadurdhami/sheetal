// The HTTP side of the guided setup: GET /setup and POST /setup/state. Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { SetupService } from "./setup.service.js";

const body = z.object({ hidden: z.boolean().optional(), tourSeen: z.boolean().optional() });

export class SetupController extends BaseController<never, never, never> {
  constructor(private readonly s: SetupService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/setup", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    app.get("/setup", async (req) => ({ data: await this.s.status(await this.ctxOf(req)) }));
    app.post("/setup/state", async (req) => ({ data: await this.s.setState(await this.ctxOf(req), body.parse(req.body)) }));
  }
}
