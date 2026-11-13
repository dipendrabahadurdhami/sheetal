// The HTTP side of Import / Export, exactly as DataActions calls it: GET /data/:kind, POST /data/:kind (5 MB, 20 an hour).
// Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { DataService } from "./data.service.js";

type K = { Params: { kind: string } };

export class DataController extends BaseController<never, never, never> {
  constructor(private readonly s: DataService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/data", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    app.get<K>("/data/:kind", async (req) => ({ data: await this.s.browse(await this.ctxOf(req), req.params.kind) }));
    app.post<K>("/data/:kind", { bodyLimit: 5 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req) => this.s.importRows(await this.ctxOf(req), req.params.kind, req.body));
  }
}
