// AI accounts: a business's own Anthropic key (Business → AI accounts).
// Where it fits: LiveAiAccounts.jsx. Once saved, the business's AI features (lead finder, Ask AI on its listings) use
// this key instead of Sheetal's (aiFor() in backend-core/src/lib/ai.ts).
// How it works: the key is sealed with the Vault and kept in AppSetting "ai.tenant.<tenantId>" with its last 4
// characters, the model (from a fixed list) and a monthly cap in credits (1 credit = about 1,000 tokens; 0 = no cap).
// "Test" asks the model for one word. Usage with the key is marked own, so it doesn't use up the plan's credits.
// Rules: the key is write-only: the API only ever says hasKey and the last 4; only people who can change business
// settings; Sheetal can switch own keys off for everyone (Admin → Integrations → AI, allowOwnKeys); saving, testing and
// removing are audited (never the key).

import type { FastifyInstance } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, badRequest, forbidden } from "@sheetal/backend-core/lib/errors";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { DEFAULT_MODEL, OWN_MODELS, creditsUsed, tenantAiKey, type AiClient, type TenantAi } from "@sheetal/backend-core/lib/ai";
import { workspaceOf, type Workspace } from "../access.js";

export async function aiAccountRoutes(app: FastifyInstance, opts: { ai?: { client: AiClient; model: string } }) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const need = (ws: Workspace) => { if (!ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete")) throw forbidden("Your role can't change AI accounts."); };
  const audit = (ws: Workspace, ip: string, action: string, meta?: object) =>
    db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target: "ai", ip, meta: meta as object | undefined } });
  const load = async (tenantId: string) => ((await db().appSetting.findUnique({ where: { key: tenantAiKey(tenantId) } }))?.value ?? {}) as TenantAi;
  const save = (tenantId: string, v: TenantAi) => db().appSetting.upsert({ where: { key: tenantAiKey(tenantId) }, create: { key: tenantAiKey(tenantId), value: v as object }, update: { value: v as object } });
  /** Sheetal can turn own keys off for everyone; on unless it says false. */
  const allowed = async () => ((await db().appSetting.findUnique({ where: { key: "integration.ai" } }))?.value as { allowOwnKeys?: boolean } | undefined)?.allowOwnKeys !== false;

  const view = async (tenantId: string) => {
    const s = await load(tenantId);
    return { hasKey: !!s.key, last4: s.last4 ?? null, model: s.model ?? DEFAULT_MODEL, cap: s.cap ?? 0, enabled: s.enabled !== false, used: await creditsUsed(db(), tenantId, new Date(), true), models: OWN_MODELS, allowed: await allowed() };
  };

  app.get("/ai-account", async (request) => {
    const ws = workspaceOf(request); need(ws);
    return { data: await view(ws.tenantId) };
  });

  app.put("/ai-account", async (request) => {
    const ws = workspaceOf(request); need(ws);
    if (!(await allowed())) throw forbidden("Sheetal hasn't turned on your own AI accounts. The included AI keeps working.");
    const b = z.object({
      apiKey: z.string().trim().regex(/^sk-ant-[A-Za-z0-9_-]{20,300}$/, "That doesn't look like an Anthropic key. It starts with sk-ant-.").optional(),
      model: z.enum(OWN_MODELS.map((m) => m.id) as [string, ...string[]]).optional(),
      cap: z.number().int().min(0).max(10_000_000).optional(),
      enabled: z.boolean().optional(),
    }).parse(request.body);
    const cur = await load(ws.tenantId);
    if (!cur.key && !b.apiKey) throw badRequest("Paste your Anthropic key first.");
    const next: TenantAi = { ...cur, model: b.model ?? cur.model ?? DEFAULT_MODEL, cap: b.cap ?? cur.cap ?? 0, enabled: b.enabled ?? cur.enabled ?? true };
    if (b.apiKey) { next.key = vault.seal(b.apiKey); next.last4 = b.apiKey.slice(-4); }
    await save(ws.tenantId, next);
    await audit(ws, request.ip, b.apiKey ? "ai.key_save" : "ai.settings", { model: next.model, cap: next.cap, enabled: next.enabled, last4: next.last4 });
    return { status: 200, message: b.apiKey ? "AI key saved." : "Saved.", data: await view(ws.tenantId) };
  });

  app.post("/ai-account/test", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request); need(ws);
    const s = await load(ws.tenantId);
    if (!s.key) throw badRequest("Save your Anthropic key first.");
    let client: AiClient | undefined = opts.ai?.client;
    if (!client) {
      let key: string;
      try { key = vault.open(s.key); } catch { throw new AppError(409, "ai_key", "The saved key can't be read. Paste it again."); }
      client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 30_000 });
    }
    try {
      await client.messages.create({ model: s.model || DEFAULT_MODEL, max_tokens: 16, messages: [{ role: "user", content: "Reply with one word: ready" }] });
    } catch (e) {
      await audit(ws, request.ip, "ai.test", { ok: false });
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AppError(422, "ai_key", "Anthropic didn't accept this key. Check it and paste it again.");
      if (e instanceof Anthropic.RateLimitError) throw new AppError(429, "ai_busy", "Your Anthropic account is busy or out of credit. Check its billing page.");
      if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError) throw new AppError(422, "ai_model", "Your account can't use this model. Pick another one.");
      throw new AppError(503, "ai_down", "Couldn't reach Anthropic. Try again in a minute.");
    }
    await audit(ws, request.ip, "ai.test", { ok: true });
    return { status: 200, message: "Your AI key works." };
  });

  app.delete("/ai-account", async (request) => {
    const ws = workspaceOf(request); need(ws);
    await db().appSetting.deleteMany({ where: { key: tenantAiKey(ws.tenantId) } });
    await audit(ws, request.ip, "ai.key_remove");
    return { status: 200, message: "Your key was removed. The included AI is used again.", data: await view(ws.tenantId) };
  });
}
