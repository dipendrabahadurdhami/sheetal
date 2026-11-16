// Business -> AI: the business's own AI accounts and its AI choices (MB 10.4, INTEGRATIONS.md; P3-FE-6). The Integration Center's business twin
// for the four AI providers only: Claude, OpenAI, Gemini (text) and ElevenLabs (voice), at scope "business" (the owner's own key).
//   GET    /v1/ai/connections            the four, each with its state, mode, health and fields (never a key)
//   PUT    /v1/ai/connections/:id        { values, version? }   save the details (the key is sealed; staged when already live)
//   POST   /v1/ai/connections/:id/test   a one-token check with the saved key
//   POST   /v1/ai/connections/:id/go-live | /pause { reason } | /resume
//   DELETE /v1/ai/connections/:id        disconnect (the key is deleted)
//   PUT    /v1/ai/settings               { preferred, fallbackToSheetal }   the business.ai setting
// Where it fits: registered in business/backend/src/app.ts under /v1 (next to GET /v1/ai/credits). The router (platform/src/ai/router.ts) reads the
// live connections and business.ai on every AI call.
// How it works: no logic here; IntegrationService decides (the same class as Admin -> Integrations). Bodies in bodies.ts.
// Rules: workspace.settings.update (the business.ai setting's own permission). Keys are write-only: no route returns one. Saves are limited to
// 20 an hour and tests to 10 an hour per business; a read-only support session is refused before anything else.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { dbOf } from "@sheetal/platform/db/client";
import { forbidden, notFound } from "@sheetal/platform/core/errors";
import { SettingsService } from "@sheetal/platform/settings/service";
import { Vault } from "@sheetal/platform/auth/vault";
import { IntegrationService } from "@sheetal/platform/integrations/service";
import { BUSINESS_AI } from "@sheetal/platform/ai/settings";
import type { Fetch } from "@sheetal/backend-core/lib/payments";
import { workspaceOf } from "../access.js";
import { AiSettingsBody, OWN_AI_IDS, OwnKeyPause, OwnKeySave } from "./bodies.js";

export async function ownAiKeyRoutes(app: FastifyInstance, opts: { fetch?: Fetch } = {}) {
  const env = app.config.NODE_ENV === "production" ? "production" : app.config.NODE_ENV === "test" ? "test" : "development";
  let svc: IntegrationService | null = null;
  const service = () => (svc ??= new IntegrationService({ db: dbOf(app), vault: new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production"), env, fetch: opts.fetch as never, log: app.log }));

  /** The open business as the connection owner, after the permission and support-session checks. */
  const owner = (request: FastifyRequest, write: boolean) => {
    const ws = workspaceOf(request);
    if (!ws.can("workspace.settings.update")) throw forbidden("Only people who change business settings can manage AI accounts.");
    if (write && request.support?.readOnly) throw forbidden("This is a read-only support session. Changes are not allowed.");
    return { ws, owner: { scope: "business" as const, tenantId: ws.tenantId }, who: { actorId: ws.user.id, ip: request.ip } };
  };
  const idOf = (request: FastifyRequest) => {
    const id = (request.params as { id?: string }).id ?? "";
    if (!(OWN_AI_IDS as readonly string[]).includes(id)) throw notFound("That AI account doesn't exist.");
    return id;
  };

  app.get("/ai/connections", async (request) => {
    const { owner: o } = owner(request, false);
    return { data: await Promise.all(OWN_AI_IDS.map((id) => service().get(o, id))) };
  });
  app.put("/ai/connections/:id", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request) => {
    const { owner: o, who } = owner(request, true);
    const b = OwnKeySave.parse(request.body);
    return service().save(o, who, idOf(request), { values: b.values, mode: "live", version: b.version });
  });
  app.post("/ai/connections/:id/test", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const { owner: o, who } = owner(request, true);
    return service().test(o, who, idOf(request));
  });
  app.post("/ai/connections/:id/go-live", async (request) => { const { owner: o, who } = owner(request, true); return service().goLive(o, who, idOf(request)); });
  app.post("/ai/connections/:id/pause", async (request) => {
    const { owner: o, who } = owner(request, true);
    return service().pause(o, who, idOf(request), OwnKeyPause.parse(request.body ?? {}).reason);
  });
  app.post("/ai/connections/:id/resume", async (request) => { const { owner: o, who } = owner(request, true); return service().resume(o, who, idOf(request)); });
  app.delete("/ai/connections/:id", async (request) => { const { owner: o, who } = owner(request, true); return service().disconnect(o, who, idOf(request)); });

  app.put("/ai/settings", async (request) => {
    const { ws } = owner(request, true);
    const b = AiSettingsBody.parse(request.body);
    const value = await new SettingsService(dbOf(app), request.log).set(BUSINESS_AI, b, { actorId: ws.user.id, ip: request.ip }, { tenantId: ws.tenantId });
    return { message: "Saved.", data: value };
  });
}
