// The HTTP side of branches and business settings, exactly as Settings → Branches, the branch picker, Settings tabs and Listing check-ups call them:
// GET /branches, POST /branches (201), PATCH /branches/:id, DELETE /branches/:id; GET /workspace/settings, PUT /workspace/settings/:section,
// POST /workspace/settings/qr (28 MB); GET /catalog; POST /listings/:code/checkup, GET /checkups/log. Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { WorkspaceService } from "./workspace.service.js";

type P = { Params: { id: string } };

export class WorkspaceController extends BaseController<never, never, never> {
  constructor(private readonly s: WorkspaceService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) { super(s as never, { basePath: "/branches", standardRoutes: [], contextOf }); }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/branches", async (req) => ({ data: await s.branchList(await ctx(req)) }));
    app.post("/branches", async (req) => s.addBranch(await ctx(req), req.body));
    app.patch<P>("/branches/:id", async (req) => s.editBranch(await ctx(req), req.params.id, req.body));
    app.delete<P>("/branches/:id", async (req) => s.removeBranch(await ctx(req), req.params.id));
    app.get("/workspace/settings", async (req) => ({ data: await s.readSettings(await ctx(req)) }));
    app.put<{ Params: { section: string } }>("/workspace/settings/:section", async (req) => s.saveSection(await ctx(req), req.params.section, req.body));
    app.post("/workspace/settings/qr", { bodyLimit: 28 * 1024 * 1024 }, async (req) => ({ data: await s.uploadQr(await ctx(req), req.body) }));
    app.get("/catalog", async () => ({ data: await s.catalog() }));
    app.post<{ Params: { code: string } }>("/listings/:code/checkup", async (req) => s.checkup(await ctx(req), req.params.code, req.body));
    app.get("/checkups/log", async (req) => ({ data: await s.checkupLog(await ctx(req)) }));
  }
}
