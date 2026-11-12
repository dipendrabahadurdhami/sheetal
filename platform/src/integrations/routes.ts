// The admin routes of the Integration Center (INTEGRATIONS.md section 11), platform scope: Sheetal's own connections.
// Where it fits: admin/backend/src/app.ts registers integrationAdminRoutes(app, { service, staffOf }) under /v1 (a route file does nothing until app.ts
// registers it). The business twin (/v1/integrations, scope "business") uses the same service and arrives with the Phase 2 settings screens.
// How it works: reading needs platform.integration.read; every change needs platform.integration.manage. Secrets are write-only: no route returns one.
//   GET    /admin/integrations                 every integration with its state, health and steps
//   GET    /admin/integrations/:id             one, with the same view
//   PUT    /admin/integrations/:id             { values, mode?, version? }  save fields (staged when live)
//   POST   /admin/integrations/:id/test        ?staged=1 tests the waiting change
//   POST   /admin/integrations/:id/go-live | /pause { reason } | /resume | /apply
//   DELETE /admin/integrations/:id             disconnect (keys deleted)
//   GET    /admin/integrations/:id/log         the last 50 test-log rows
//   GET    /admin/integrations/:id/guide       the help guide (?lang=en|ne)
// Rules: no logic here; the service decides. Saves are limited to 20 an hour and tests to 10 an hour per staff member.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { badRequest } from "../core/errors.js";
import type { StaffContext } from "../core/context.js";
import { PLATFORM, type IntegrationService } from "./service.js";

export interface IntegrationRoutesOptions {
  service: IntegrationService;
  staffOf: (req: FastifyRequest) => StaffContext;
}

const SaveBody = z.object({
  values: z.record(z.string().max(60), z.string().max(4000)),
  mode: z.enum(["test", "live"]).optional(),
  version: z.number().int().min(0).optional(),
}).strict();
const PauseBody = z.object({ reason: z.string().max(400) }).strict();

const idOf = (req: FastifyRequest): string => {
  const id = (req.params as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" || !/^[a-z][a-z0-9_.]{1,40}$/.test(id)) throw badRequest("Bad id.");
  return id;
};

export async function integrationAdminRoutes(app: FastifyInstance, o: IntegrationRoutesOptions) {
  const { service } = o;
  const reader = (req: FastifyRequest) => { const s = o.staffOf(req); s.permissions.require("platform.integration.read", "Your staff role can't see connections."); return s; };
  const manager = (req: FastifyRequest) => { const s = o.staffOf(req); s.permissions.require("platform.integration.manage", "Only staff who manage connections can change them."); return { actorId: s.staff.id, ip: req.ip }; };
  const canManage = (req: FastifyRequest) => o.staffOf(req).permissions.can("platform.integration.manage");

  app.get("/admin/integrations", async (req) => { reader(req); return { data: await service.list(PLATFORM), meta: { canManage: canManage(req) } }; });
  app.get("/admin/integrations/:id", async (req) => { reader(req); return { data: await service.get(PLATFORM, idOf(req)), meta: { canManage: canManage(req) } }; });
  app.get("/admin/integrations/:id/log", async (req) => { reader(req); return { data: await service.testLog(PLATFORM, idOf(req)) }; });
  app.get("/admin/integrations/:id/guide", async (req) => {
    reader(req);
    const lang = (req.query as { lang?: string } | undefined)?.lang === "ne" ? "ne" : "en";
    return { data: await service.guide(PLATFORM, idOf(req), lang) };
  });

  app.put("/admin/integrations/:id", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req) => service.save(PLATFORM, manager(req), idOf(req), SaveBody.parse(req.body)));
  app.post("/admin/integrations/:id/test", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    const staged = (req.query as { staged?: string } | undefined)?.staged === "1";
    return service.test(PLATFORM, manager(req), idOf(req), { staged });
  });
  app.post("/admin/integrations/:id/go-live", async (req) => service.goLive(PLATFORM, manager(req), idOf(req)));
  app.post("/admin/integrations/:id/pause", async (req) => service.pause(PLATFORM, manager(req), idOf(req), PauseBody.parse(req.body).reason));
  app.post("/admin/integrations/:id/resume", async (req) => service.resume(PLATFORM, manager(req), idOf(req)));
  app.post("/admin/integrations/:id/apply", async (req) => service.apply(PLATFORM, manager(req), idOf(req)));
  app.delete("/admin/integrations/:id", async (req) => service.disconnect(PLATFORM, manager(req), idOf(req)));
}
