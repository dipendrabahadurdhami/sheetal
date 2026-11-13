// The HTTP side of the lead finder and Meta's webhook, exactly as the Inbox and Meta call them: POST /ai/extract-leads (300 KB, 30 an hour);
// GET /webhooks/meta (Meta's subscribe check), POST /webhooks/meta (signed by Meta, 600 a minute).
// Rules: no business logic and no Prisma here. The webhook sits in its own scope so it can read the exact bytes Meta signed.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { metaSignatureOk } from "@sheetal/backend-core/lib/meta";
import type { FinderService } from "./finder.service.js";

export class FinderController extends BaseController<never, never, never> {
  constructor(private readonly s: FinderService, contextOf: (req: FastifyRequest) => Promise<BusinessContext>) {
    super(s as never, { basePath: "/ai", standardRoutes: [], contextOf });
  }
  protected override routes(app: FastifyInstance): void {
    const s = this.s;
    app.post("/ai/extract-leads", { bodyLimit: 300_000, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req) => s.extract(await this.ctxOf(req), req.body));
    void app.register(async (hook) => {
      hook.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
        (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
        try { done(null, JSON.parse((body as Buffer).toString("utf8") || "{}")); } catch (e) { done(e as Error, undefined); }
      });
      hook.get("/webhooks/meta", async (req, reply) => {
        const q = req.query as Record<string, string>;
        const m = await s.metaKeys();
        if (q["hub.mode"] === "subscribe" && m.verifyToken && q["hub.verify_token"] === m.verifyToken) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
        return reply.code(403).send();
      });
      hook.post("/webhooks/meta", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
        const m = await s.metaKeys();
        const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.from("");
        if (!m.appSecret || !metaSignatureOk(m.appSecret, raw, req.headers["x-hub-signature-256"] as string | undefined)) return reply.code(401).send();
        await s.received(req.body, { requestId: String(req.id), ip: req.ip, log: req.log });
        // Meta wants a quick 200, or it retries.
        return reply.code(200).send({ ok: true });
      });
    });
  }
}
