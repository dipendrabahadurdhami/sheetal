// The HTTP side of the business Overview, exactly as LiveOverview.jsx calls it: GET /overview.
// Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { OverviewService } from "./overview.service.js";

export class OverviewController extends BaseController<never, never, never> {
  constructor(private readonly s: OverviewService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/overview", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    app.get("/overview", async (req) => ({ data: await this.s.overview(await this.ctxOf(req)) }));
  }
}
