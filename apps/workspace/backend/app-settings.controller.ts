// The HTTP side of the per-app settings tabs, exactly as AppSettingsPage.jsx calls them: GET /workspace/app-settings, PUT /workspace/app-settings/:key.
// Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { AppSettingsService } from "./app-settings.service.js";

type P = { Params: { key: string } };
export class AppSettingsController extends BaseController<never, never, never> {
  constructor(private readonly s: AppSettingsService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/workspace/app-settings", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    app.get("/workspace/app-settings", async (req) => ({ data: await this.s.list(await this.ctxOf(req)) }));
    app.put<P>("/workspace/app-settings/:key", async (req) => this.s.change(await this.ctxOf(req), req.params.key, req.body));
  }
}
