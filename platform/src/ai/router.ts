// The AI router (MARKETPLACE-AND-BILLING.md section 10; INTEGRATIONS.md section 2.2; P3-BE-8): for one AI feature use, decide locked /
// own key / Sheetal AI, run the model call, and take or give back the credits.
// Where it fits: apps call runAi() for a business on billingMode "apps" (the old aiFor() in backend-core/src/lib/ai.ts stays for "plans").
// aiStateFor() is what Entitlements.ai(appId) answers (loaded by platform/src/billing/load.ts) and what GET /v1/ai/credits shows.
// How it works:
//   1. Own key: the business's live AI connections (Integration Center, business scope; the older single Anthropic key in "ai.tenant.<id>"
//      counts as Claude), the preferred one first (business.ai). Sheetal can switch own keys off for everyone (integration.ai allowOwnKeys).
//   2. Else Sheetal AI: credits left (platform/src/billing/ai-credits.ts) and one of Sheetal's own AI connections live.
//   3. Else locked: no model call at all; the feature's preview is returned and a usage row of source "preview" (0 credits) is written.
// With Sheetal AI the credits of the largest possible answer are taken BEFORE the call (402 ai_credits_used when short, so a refused call
// never reaches the provider); after the call the unused part is given back, and a failed call gets everything back, in the same request.
// An own key that fails answers with a clear message; only when the owner switched on "If my key fails, use Sheetal AI" does it go on to step 2.
// Rules: keys never leave this process: errors are rebuilt from the provider's safe message, nothing here logs a context or a request body.
// Own-key calls take no credits (their usage row says own). One AiUsage row per call.

import type { FastifyBaseLogger } from "fastify";
import { AppError } from "../core/errors.js";
import type { Db } from "../db/client.js";
import type { Vault } from "../auth/vault.js";
import { SettingsService } from "../settings/service.js";
import { CATALOG_SETTING, withNewApps } from "../billing/catalog.js";
import { creditBalance, creditsFor, giveBack, spend, type Capability, type Taken } from "../billing/ai-credits.js";
import { integrationOf } from "../integrations/registry.js";
import { AiCallError, isAiProvider, type AiResponse } from "../integrations/providers/ai.js";
import type { Fetch, IntegrationContext } from "../integrations/types.js";
import { AI_PROVIDER_IDS, BUSINESS_AI, type BusinessAiSettings } from "./settings.js";

export type AiState = "locked" | "own_key" | "sheetal";
type ProviderId = (typeof AI_PROVIDER_IDS)[number];
const LEGACY = "legacy.anthropic";

/** What the router needs; the business and admin APIs build it once (integrations = their IntegrationService). */
export interface AiDeps {
  db: Db;
  integrations: { contextFor(owner: { scope: "platform" | "business"; tenantId: string | null }, id: string): Promise<IntegrationContext | null> };
  log: FastifyBaseLogger;
  vault?: Vault;
  fetch?: Fetch;
  now?: () => Date;
}

/** The choice, as plain data (tested on its own). */
export function chooseRoute(o: { own: readonly string[]; preferred: BusinessAiSettings["preferred"]; allowOwnKeys: boolean; balance: number; sheetalReady: boolean }): { state: AiState; order: string[] } {
  if (o.allowOwnKeys && o.own.length) {
    const order = [...o.own].sort((a, b) => (a === o.preferred ? -1 : b === o.preferred ? 1 : 0));
    return { state: "own_key", order };
  }
  if (o.balance > 0 && o.sheetalReady) return { state: "sheetal", order: [] };
  return { state: "locked", order: [] };
}

const store = (d: AiDeps) => new SettingsService(d.db, d.log);
const allowOwnKeys = async (db: Db) => ((await db.appSetting.findUnique({ where: { key: "integration.ai" } }))?.value as { allowOwnKeys?: boolean } | undefined)?.allowOwnKeys !== false;

/** The legacy single Anthropic key of a business (Business -> AI accounts, before the Integration Center), as a provider context. */
async function legacyContext(d: AiDeps, tenantId: string): Promise<IntegrationContext | null> {
  if (!d.vault) return null;
  const row = (await d.db.appSetting.findUnique({ where: { key: `ai.tenant.${tenantId}` } }))?.value as { key?: string; model?: string; enabled?: boolean } | undefined;
  if (!row?.key || row.enabled === false) return null;
  let key: string | undefined;
  try { key = d.vault.open(row.key); } catch { return null; }
  if (!key) return null;
  return {
    connection: { state: "live" } as unknown as IntegrationContext["connection"], config: { model: row.model ?? "" }, mode: "live",
    secrets: { get: (f) => (f === "apiKey" ? key : undefined), has: (f) => f === "apiKey" }, env: "production",
    fetch: d.fetch ?? fetch, log: d.log, now: d.now?.() ?? new Date(),
  };
}

async function ownContexts(d: AiDeps, tenantId: string): Promise<Map<string, IntegrationContext>> {
  const out = new Map<string, IntegrationContext>();
  for (const id of AI_PROVIDER_IDS) {
    const c = await d.integrations.contextFor({ scope: "business", tenantId }, id);
    if (c) out.set(id, c);
  }
  if (!out.has("ai.anthropic")) { const l = await legacyContext(d, tenantId); if (l) out.set(LEGACY, l); }
  return out;
}
async function sheetalContext(d: AiDeps): Promise<{ id: ProviderId; ctx: IntegrationContext } | null> {
  for (const id of AI_PROVIDER_IDS) {
    const ctx = await d.integrations.contextFor({ scope: "platform", tenantId: null }, id);
    if (ctx) return { id, ctx };
  }
  return null;
}

/** The state an AI feature has for this business now (Entitlements.ai and the AI screen). */
export async function aiStateFor(d: AiDeps, tenantId: string): Promise<{ state: AiState; own: string[]; balance: number; sheetalReady: boolean; settings: BusinessAiSettings }> {
  const now = d.now?.() ?? new Date();
  const [own, allow, balance, sheetal, settings] = await Promise.all([
    ownContexts(d, tenantId), allowOwnKeys(d.db), creditBalance(d.db, tenantId, now), sheetalContext(d), store(d).get(BUSINESS_AI, { tenantId }),
  ]);
  const r = chooseRoute({ own: [...own.keys()], preferred: settings.preferred, allowOwnKeys: allow, balance, sheetalReady: !!sheetal });
  return { state: r.state, own: [...own.keys()], balance, sheetalReady: !!sheetal, settings };
}

/** The same answer from the database alone, for Entitlements.ai on every request (no vault, no provider call): a live own AI connection
 *  (or the older saved key) -> own_key; else credits and a live Sheetal AI connection -> sheetal; else locked. */
export async function aiStateQuick(db: Db, tenantId: string, now: Date): Promise<AiState> {
  const ids = [...AI_PROVIDER_IDS];
  const [own, legacy, allow, balance, platform] = await Promise.all([
    db.integrationConnection.count({ where: { scope: "business", tenantId, integrationId: { in: ids }, state: "live", healthStatus: { not: "down" } } }),
    db.appSetting.findUnique({ where: { key: `ai.tenant.${tenantId}` } }),
    allowOwnKeys(db), creditBalance(db, tenantId, now),
    db.integrationConnection.count({ where: { scope: "platform", integrationId: { in: ids }, state: "live", healthStatus: { not: "down" } } }),
  ]);
  const legacyOn = !!(legacy?.value as { key?: string; enabled?: boolean } | undefined)?.key && (legacy?.value as { enabled?: boolean }).enabled !== false;
  return chooseRoute({ own: own > 0 || legacyOn ? ["own"] : [], preferred: "auto", allowOwnKeys: allow, balance, sheetalReady: platform > 0 }).state;
}

export interface AiRun {
  tenantId: string; userId?: string | null; appId: string; feature: string; capability: Exclude<Capability, "voice">;
  system: string; prompt: string; maxTokens: number; requestId?: string;
  /** What a locked feature shows: a sample answer on example data (static, never a model call). */
  preview?: string;
}
export type AiResult =
  | { state: "locked"; preview: string | null }
  | { state: "own_key" | "sheetal"; text: string; provider: string; model: string; credits: number; balance: number | null };

function ownError(e: AiCallError, provider: string): AppError {
  const name = provider === LEGACY ? "Claude" : integrationOf(provider)?.describe().name.en ?? "AI";
  if (e.kind === "key") return new AppError(503, "ai_key", `Your ${name} key didn't work: ${e.message} Check it in Settings → Integrations.`);
  if (e.kind === "busy") return new AppError(429, "ai_busy", `${name} is busy right now. Please try again in a minute.`);
  if (e.kind === "request") return new AppError(400, "ai_request", e.message || "The AI couldn't take this request. Try shorter text.");
  return new AppError(503, "ai_down", `${name} didn't answer. Please try again.`);
}
function sheetalError(e: AiCallError): AppError {
  if (e.kind === "busy") return new AppError(429, "ai_busy", "The AI is busy right now. Please try again in a minute.");
  if (e.kind === "request") return new AppError(400, "ai_request", e.message || "The AI couldn't take this request. Try shorter text.");
  return new AppError(503, "ai_off", "AI isn't available right now. Sheetal has been told. Your credits were not used.");
}

async function call(id: string, ctx: IntegrationContext, r: AiRun): Promise<AiResponse> {
  const p = integrationOf(id === LEGACY ? "ai.anthropic" : id);
  if (!isAiProvider(p)) throw new AiCallError("down", "This AI provider can't answer yet.");
  return p.complete(ctx, { system: r.system, prompt: r.prompt, maxTokens: r.maxTokens });
}

const usage = (d: AiDeps, r: AiRun, o: { model: string; provider: string | null; source: "sheetal" | "own" | "preview"; inputTok: number; outputTok: number; credits: number }, db: Pick<Db, "aiUsage"> = d.db) =>
  db.aiUsage.create({ data: {
    tenantId: r.tenantId, userId: r.userId ?? null, feature: r.feature.slice(0, 60), appId: r.appId, model: o.model.slice(0, 100), provider: o.provider === LEGACY ? "ai.anthropic" : o.provider,
    source: o.source, own: o.source === "own", inputTok: o.inputTok, outputTok: o.outputTok, credits: o.credits, requestId: r.requestId ?? null,
  } });

/** Runs one AI feature use for a business. Throws AppError with a person's message (402 ai_credits_used, 503 ai_key / ai_off, 429, 400). */
export async function runAi(d: AiDeps, r: AiRun): Promise<AiResult> {
  if (!Number.isInteger(r.maxTokens) || r.maxTokens < 1 || r.maxTokens > 32_000) throw new Error("runAi: maxTokens out of range");
  const now = d.now?.() ?? new Date();
  const [own, allow, settings] = await Promise.all([ownContexts(d, r.tenantId), allowOwnKeys(d.db), store(d).get(BUSINESS_AI, { tenantId: r.tenantId })]);
  const balance = await creditBalance(d.db, r.tenantId, now);
  const sheetal = await sheetalContext(d);
  const route = chooseRoute({ own: [...own.keys()], preferred: settings.preferred, allowOwnKeys: allow, balance, sheetalReady: !!sheetal });

  if (route.state === "own_key") {
    const id = route.order[0]!;
    try {
      const res = await call(id, own.get(id)!, r);
      const rates = withNewApps(await store(d).get(CATALOG_SETTING)).ai?.creditRates ?? { text: 1, vision: 2, voicePerMinute: 5 };
      await usage(d, r, { model: res.model, provider: id, source: "own", inputTok: res.inputTokens, outputTok: res.outputTokens, credits: creditsFor(rates, r.capability, { tokens: res.inputTokens + res.outputTokens }) });
      return { state: "own_key", text: res.text, provider: id === LEGACY ? "ai.anthropic" : id, model: res.model, credits: 0, balance: null };
    } catch (e) {
      if (!(e instanceof AiCallError)) throw e;
      // Only the owner's own switch lets a failing key fall back to Sheetal credits.
      const canFallBack = settings.fallbackToSheetal && (e.kind === "key" || e.kind === "down") && balance > 0 && !!sheetal;
      if (!canFallBack) throw ownError(e, id);
      d.log.info({ tenantId: r.tenantId, provider: id, kind: e.kind }, "ai: own key failed, using Sheetal AI as the owner allowed");
    }
  } else if (route.state === "locked") {
    await usage(d, r, { model: "", provider: null, source: "preview", inputTok: 0, outputTok: 0, credits: 0 });
    return { state: "locked", preview: r.preview ?? null };
  }

  // Sheetal AI: reserve the most this call can cost, call, then give back what was not used (all of it when the call fails).
  if (!sheetal) throw new AppError(503, "ai_off", "AI isn't available right now. Sheetal has been told.");
  const rates = withNewApps(await store(d).get(CATALOG_SETTING)).ai?.creditRates ?? { text: 1, vision: 2, voicePerMinute: 5 };
  const estimateIn = Math.ceil((r.system.length + r.prompt.length) / 3);
  const reserve = creditsFor(rates, r.capability, { tokens: estimateIn + r.maxTokens });
  const taken: Taken[] = await d.db.$transaction((tx) => spend(tx, { tenantId: r.tenantId, credits: reserve, now }));
  let res: AiResponse;
  try {
    res = await call(sheetal.id, sheetal.ctx, r);
  } catch (e) {
    await d.db.$transaction((tx) => giveBack(tx, taken, reserve));
    if (e instanceof AiCallError) {
      if (e.kind === "key" || e.kind === "down") d.log.error({ provider: sheetal.id, kind: e.kind }, "ai: Sheetal's own AI connection failed");
      throw sheetalError(e);
    }
    throw e;
  }
  const used = Math.min(reserve, creditsFor(rates, r.capability, { tokens: res.inputTokens + res.outputTokens }));
  await d.db.$transaction(async (tx) => {
    if (used < reserve) await giveBack(tx, taken, reserve - used);
    await usage(d, r, { model: res.model, provider: sheetal.id, source: "sheetal", inputTok: res.inputTokens, outputTok: res.outputTokens, credits: used }, tx);
  });
  return { state: "sheetal", text: res.text, provider: sheetal.id, model: res.model, credits: used, balance: await creditBalance(d.db, r.tenantId, now) };
}
