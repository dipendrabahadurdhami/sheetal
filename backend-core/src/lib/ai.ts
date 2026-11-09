// AI features (Ask AI on the website, the lead finder in the business panel), run on the server only.
// Where it fits: called by the website API (ask-ai) and the business API (extract-leads); settings come from
// Admin → AI.
// How it works: the AI key is saved encrypted from the admin panel (or ANTHROPIC_API_KEY); every request is
// recorded and counted against the business's monthly AI credits (1 credit per 1,000 tokens, at least 1).
// Rules: the key never reaches a browser; answers only use public facts about listings.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Db } from "./db.js";
import { Vault } from "./vault.js";
import { AppError } from "./errors.js";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const AI_CREDITS: Record<string, number> = { Starter: 500, Business: 2000, Pro: 6000 }; // mirrors shared/src/core/plans.js

export interface AiSettings { enabled?: boolean; model?: string; apiKey?: string; credits?: Record<string, number> }

/** The client to use, or null when AI isn't set up. Tests pass their own `client`. */
export async function aiClient(db: Db, vault: Vault, env: NodeJS.ProcessEnv = process.env) {
  const s = ((await db.appSetting.findUnique({ where: { key: "ai" } }))?.value ?? {}) as AiSettings;
  if (s.enabled === false) return null;
  // Credits saved in Admin → AI (ai.features) win over the older "ai" credits.
  const f = ((await db.appSetting.findUnique({ where: { key: "ai.features" } }))?.value ?? {}) as { plans?: Record<string, { credits?: number }> };
  const planCredits = Object.fromEntries(Object.entries(f.plans ?? {}).filter(([, p]) => typeof p.credits === "number").map(([n, p]) => [n, p.credits!]));
  let key: string | undefined;
  try { key = s.apiKey ? vault.open(s.apiKey) : undefined; } catch { key = undefined; }
  key ??= env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return { client: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }), model: s.model || DEFAULT_MODEL, credits: { ...AI_CREDITS, ...(s.credits ?? {}), ...planCredits } };
}
export type AiClient = Pick<Anthropic, "messages" | "beta">;

/** Credits used by a business this month. */
export async function creditsUsed(db: Db, tenantId: string, now = new Date()) {
  const r = await db.aiUsage.aggregate({ where: { tenantId, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } }, _sum: { credits: true } });
  return r._sum.credits ?? 0;
}

async function record(db: Db, o: { tenantId?: string | null; userId?: string | null; feature: string; model: string; usage: { input_tokens: number; output_tokens: number } }) {
  const credits = Math.max(1, Math.ceil((o.usage.input_tokens + o.usage.output_tokens) / 1000));
  await db.aiUsage.create({ data: { tenantId: o.tenantId, userId: o.userId, feature: o.feature, model: o.model, inputTok: o.usage.input_tokens, outputTok: o.usage.output_tokens, credits } });
  return credits;
}

/** Turns an API failure into a message for the person; never leaks the key or raw errors. */
function aiError(e: unknown): never {
  if (e instanceof AppError) throw e;
  if (e instanceof Anthropic.RateLimitError) throw new AppError(429, "ai_busy", "The AI is busy right now. Please try again in a minute.");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AppError(503, "ai_off", "AI isn't available right now. Sheetal has been told.");
  if (e instanceof Anthropic.BadRequestError) throw new AppError(400, "ai_request", "The AI couldn't take this request. Try shorter text.");
  if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) throw new AppError(503, "ai_down", "The AI didn't answer. Please try again.");
  throw e;
}

export interface ListingFacts { code: string; title: string; facts: Record<string, unknown> }

/** Compares 1–4 listings and answers the person's question, from the listings' public facts only. */
export async function compareListings(db: Db, ai: { client: AiClient; model: string }, o: { listings: ListingFacts[]; question?: string; userId?: string | null }) {
  try {
    const res = await ai.client.beta.messages.create({
      model: ai.model, max_tokens: 4000,
      output_config: { effort: "low" },
      // If a safety check declines, the API retries on a suitable model by itself.
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: "You help people in Nepal compare properties on Sheetal Property. Use only the listing facts given; if something isn't there, say it isn't listed. Prices are in Nepali rupees (lakh and crore are fine). Be brief and practical: a short comparison, then a clear suggestion with the reason. Plain text, no markdown tables. Never invent amenities, distances or legal status.",
      messages: [{ role: "user", content: `Listings:\n${JSON.stringify(o.listings, null, 1)}\n\nQuestion: ${o.question?.trim() || "Which is the better choice, and why?"}` }],
    });
    if (res.stop_reason === "refusal") throw new AppError(422, "ai_declined", "The AI couldn't answer this one. Try asking another way.");
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    await record(db, { userId: o.userId, feature: "compare", model: res.model, usage: res.usage });
    return text || "No answer this time. Please try again.";
  } catch (e) { aiError(e); }
}

export const LeadSchema = z.object({
  leads: z.array(z.object({
    name: z.string(), phone: z.string(), email: z.string(),
    need: z.string().describe("What they want: buy, rent, invest, a stay…, and what kind of property"),
    budget: z.string(), location: z.string(), note: z.string(),
  })),
});
export type ExtractedLead = z.infer<typeof LeadSchema>["leads"][number];

/** Finds people looking for property in pasted text (Facebook comments, WhatsApp groups, notes). Uses the business's credits. */
export async function extractLeads(db: Db, ai: { client: AiClient; model: string; credits: Record<string, number> }, o: { text: string; tenantId: string; planName: string; userId: string }) {
  const limit = ai.credits[o.planName] ?? 0;
  const used = await creditsUsed(db, o.tenantId);
  if (limit !== -1 && used >= limit) throw new AppError(402, "ai_credits", `This month's ${limit.toLocaleString("en-IN")} AI credits are used up. They renew on the 1st, or upgrade for more.`);
  try {
    const res = await ai.client.messages.parse({
      model: ai.model, max_tokens: 8000,
      output_config: { effort: "low", format: zodOutputFormat(LeadSchema) },
      system: "Extract every person in the text who is looking to buy, rent, invest in or stay at a property in Nepal. Copy phone numbers and emails exactly as written; use an empty string for anything not given. Never invent contact details. Leave out sellers, agents advertising, and people with no property need.",
      messages: [{ role: "user", content: o.text }],
    });
    if (res.stop_reason === "refusal") throw new AppError(422, "ai_declined", "The AI couldn't read this text. Try a smaller part.");
    const credits = await record(db, { tenantId: o.tenantId, userId: o.userId, feature: "extract_leads", model: res.model, usage: res.usage });
    // Keep only details that really appear in the text, so nothing made up gets saved.
    const digits = o.text.replace(/\D/g, "");
    const leads = (res.parsed_output?.leads ?? []).map((l) => ({
      ...l, phone: l.phone && digits.includes(l.phone.replace(/\D/g, "")) ? l.phone : "", email: l.email && o.text.toLowerCase().includes(l.email.toLowerCase()) ? l.email : "",
    })).filter((l) => l.name || l.phone || l.email);
    return { leads, credits, left: limit === -1 ? -1 : Math.max(0, limit - used - credits) };
  } catch (e) { aiError(e); }
}
