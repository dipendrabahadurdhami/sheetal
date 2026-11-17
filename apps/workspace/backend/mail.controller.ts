// The HTTP side of business email, exactly as the Email page, Settings → Domain and email and the mail server call it:
// GET /mail/unread, GET /mail; POST /mail/domains, POST /mail/domains/:id/check, DELETE /mail/domains/:id; GET /mail/team, POST /mail/mailboxes,
// PATCH /mail/mailboxes/:id, DELETE /mail/mailboxes/:id; GET /mail/mailboxes/:id/messages, GET /mail/messages/:id, GET /mail/attachments/:id,
// PATCH /mail/messages/:id, DELETE /mail/messages/:id; POST /mail/drafts, POST /mail/send (30 MB, 60 a minute); POST /mail/inbound (mail server only,
// shared secret in "x-mail-secret", 40 MB, no rate limit).
// Rules: no business logic and no Prisma here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { MailService } from "./mail.service.js";

type P = { Params: { id: string } };

export class MailController extends BaseController<never, never, never> {
  constructor(private readonly s: MailService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/mail", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s, ctx = (req: FastifyRequest) => this.ctxOf(req);
    app.get("/mail/unread", async (req) => ({ data: await s.unread(await ctx(req)) }));
    app.get("/mail", async (req) => ({ data: await s.overview(await ctx(req)) }));
    app.post("/mail/domains", async (req) => s.addDomain(await ctx(req), req.body));
    app.post<P>("/mail/domains/:id/check", async (req) => s.checkDomain(await ctx(req), req.params.id));
    app.post<P>("/mail/domains/:id/dns/auto", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => s.autoDns(await ctx(req), req.params.id, req.body));
    app.delete<P>("/mail/domains/:id", async (req) => s.removeDomain(await ctx(req), req.params.id));
    app.get("/mail/team", async (req) => ({ data: await s.team(await ctx(req)) }));
    app.post("/mail/mailboxes", async (req) => s.addBox(await ctx(req), req.body));
    app.patch<P>("/mail/mailboxes/:id", async (req) => s.changeBox(await ctx(req), req.params.id, req.body));
    app.delete<P>("/mail/mailboxes/:id", async (req) => s.removeBox(await ctx(req), req.params.id, req.body));
    app.get<P>("/mail/mailboxes/:id/messages", async (req) => s.messages(await ctx(req), req.params.id, req.query));
    app.get<P>("/mail/messages/:id", async (req) => ({ data: await s.read(await ctx(req), req.params.id) }));
    app.get<P>("/mail/attachments/:id", async (req, reply) => {
      const a = await s.attachment(await ctx(req), req.params.id);
      return reply.header("content-type", a.contentType).header("content-disposition", `attachment; filename="${a.filename.replace(/["\r\n]/g, "")}"`).send(Buffer.from(a.data));
    });
    app.patch<P>("/mail/messages/:id", async (req) => s.flag(await ctx(req), req.params.id, req.body));
    app.delete<P>("/mail/messages/:id", async (req) => s.trash(await ctx(req), req.params.id));
    app.post("/mail/drafts", async (req) => s.saveDraft(await ctx(req), req.body));
    app.post("/mail/send", { bodyLimit: 30 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => s.send(await ctx(req), req.body));
    app.post("/mail/inbound", { bodyLimit: 40 * 1024 * 1024, config: { rateLimit: false } }, async (req, reply) => {
      const r = await s.inbound(req.headers["x-mail-secret"], req.body);
      return reply.status(r.status).send(r.body);
    });
  }
}
