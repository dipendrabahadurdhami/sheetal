// The HTTP side of online forms, exactly as LiveForms.jsx calls it: GET /forms, POST /forms (2 MB, 201), GET /forms/:id, PUT /forms/:id (2 MB),
// PATCH /forms/:id/assignee, POST /forms/:id/publish, POST /forms/:id/unpublish, DELETE /forms/:id; GET /forms/responses, GET /forms/responses.csv,
// PATCH /forms/responses/:id, GET /forms/responses/:id/files/:name (private, never cached).
// Rules: no business logic and no Prisma here. The response routes are registered before /forms/:id so "responses" is never read as a form id.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { FormService } from "./form.service.js";

type P = { Params: { id: string } };
const big = { bodyLimit: 2 * 1024 * 1024 };

export class FormController extends BaseController<never, never, never> {
  constructor(private readonly s: FormService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/forms", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/forms", async (req) => ({ data: await s.browse(await ctx(req)) }));
    app.post("/forms", big, async (req) => s.makeForm(await ctx(req), req.body));
    app.get("/forms/responses", async (req) => s.responses(await ctx(req), req.query));
    app.get("/forms/responses.csv", async (req, reply) => {
      const csv = await s.responsesCsv(await ctx(req), req.query);
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${csv.filename}"`).send(csv.body);
    });
    app.patch<P>("/forms/responses/:id", async (req) => s.checkPayment(await ctx(req), req.params.id, req.body));
    app.get<{ Params: { id: string; name: string } }>("/forms/responses/:id/files/:name", async (req, reply) => {
      const f = await s.file(await ctx(req), req.params.id, req.params.name);
      return reply.header("content-type", f.type).header("content-disposition", `inline; filename="${f.shown}"`).header("cache-control", "private, no-store").send(f.data);
    });
    app.get<P>("/forms/:id", async (req) => ({ data: await s.openForm(await ctx(req), req.params.id) }));
    app.put<P>("/forms/:id", big, async (req) => s.saveForm(await ctx(req), req.params.id, req.body));
    app.patch<P>("/forms/:id/assignee", async (req) => s.setAssignee(await ctx(req), req.params.id, req.body));
    app.post<P>("/forms/:id/publish", async (req) => s.publish(await ctx(req), req.params.id));
    app.post<P>("/forms/:id/unpublish", async (req) => s.unpublish(await ctx(req), req.params.id));
    app.delete<P>("/forms/:id", async (req) => s.removeForm(await ctx(req), req.params.id));
  }
}
