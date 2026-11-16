// The AI providers of the Integration Center (INTEGRATIONS.md sections 2.1 and 13, rows 11 to 13; MARKETPLACE-AND-BILLING.md section 10.4):
// Claude (Anthropic), OpenAI, Google Gemini and ElevenLabs voice, at platform scope (Sheetal AI) and business scope (the owner's own key).
// Where it fits: registry.ts lists them (they replace the four shells of stage 1.3, same ids and fields, so saved details stay). The AI router
// (platform/src/ai/router.ts) calls complete() / speak() with the connection a request may use; nothing else talks to these services.
// How it works: plain HTTPS through ctx.fetch (the guarded fetch of the Integration Center; tests pass a fake). test() is the cheapest real call
// (a one-token completion, or the voices list). A provider answer becomes AiCallError with a kind the router turns into a person's message:
// key (refused key or no credit at the provider), busy (rate limit), request (too long or refused input), down (anything else).
// Rules: a key is sent only in the provider's own header, never in a URL, a message, a log or a test check (safeMessage() hides it if a
// provider echoes it). No retries here: the router decides. Default models can be replaced by the owner in the connection's "Model" field.

import { check, safeMessage } from "../fields.js";
import type { Integration, IntegrationContext, IntegrationSpec, TestResult } from "../types.js";
import { BaseIntegration, USUAL_STEPS, probe } from "./base.js";

export interface AiRequest { system: string; prompt: string; maxTokens: number; model?: string }
export interface AiResponse { text: string; inputTokens: number; outputTokens: number; model: string }
export interface SpeechRequest { text: string; voiceId?: string }
export interface SpeechResponse { audio: Uint8Array; contentType: string; characters: number }
export type AiErrorKind = "key" | "busy" | "request" | "down";
export class AiCallError extends Error {
  constructor(readonly kind: AiErrorKind, message: string) { super(message); this.name = "AiCallError"; }
}

/** A text (and vision) provider: Integration + complete() (INTEGRATIONS.md section 2.1). */
export interface AiProvider extends Integration { complete(ctx: IntegrationContext, r: AiRequest): Promise<AiResponse>; models(): readonly string[] }
/** A voice provider. */
export interface VoiceProvider extends Integration { speak(ctx: IntegrationContext, r: SpeechRequest): Promise<SpeechResponse> }
export const isAiProvider = (i: Integration | null): i is AiProvider => !!i && typeof (i as Partial<AiProvider>).complete === "function";
export const isVoiceProvider = (i: Integration | null): i is VoiceProvider => !!i && typeof (i as Partial<VoiceProvider>).speak === "function";

const BOTH = ["platform", "business"] as const;
const keyField = { key: "apiKey", label: { en: "API key" }, required: true, secret: true, maxLength: 400 } as const;
const modelField = { key: "model", label: { en: "Model" }, maxLength: 200 } as const;
const spec = (id: string, name: string, model: string, guide: IntegrationSpec["guide"], capabilities = ["ai.complete"]): IntegrationSpec => ({
  id, name: { en: name }, group: "ai", icon: capabilities.includes("ai.voice") ? "phone-call" : "sparkles", scopes: BOTH, modes: ["live"], documents: [],
  steps: USUAL_STEPS, built: true, fallback: "platform", capabilities,
  fields: capabilities.includes("ai.voice") ? [keyField, { key: "voiceId", label: { en: "Voice id" }, maxLength: 200 }] : [keyField, { ...modelField, label: { en: `Model (empty = ${model})` } }],
  guide,
});

/** Reads a provider's error answer into AiCallError, with the key hidden. */
async function fail(res: Response, secrets: (string | undefined)[]): Promise<never> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } | string; detail?: { message?: string } | string; message?: string } | null;
  const raw = typeof j?.error === "string" ? j.error : j?.error?.message ?? (typeof j?.detail === "string" ? j.detail : j?.detail?.message) ?? j?.message ?? `The provider answered ${res.status}.`;
  const msg = safeMessage(raw, secrets);
  if (res.status === 401 || res.status === 403 || res.status === 402) throw new AiCallError("key", msg);
  if (res.status === 429) throw new AiCallError(/credit|quota|billing|balance/i.test(msg) ? "key" : "busy", msg);
  if (res.status === 400 || res.status === 413 || res.status === 422) throw new AiCallError(/credit|balance|billing/i.test(msg) ? "key" : "request", msg);
  throw new AiCallError("down", msg);
}
async function post(ctx: IntegrationContext, url: string, headers: Record<string, string>, body: unknown, secrets: (string | undefined)[]) {
  let res: Response;
  try { res = await ctx.fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
  catch { throw new AiCallError("down", "Couldn't reach the AI provider."); }
  if (!res.ok) await fail(res, secrets);
  return res;
}
const needKey = (ctx: IntegrationContext) => {
  const k = ctx.secrets.get("apiKey");
  if (!k) throw new AiCallError("key", "No API key is saved for this connection.");
  return k;
};
/** test() for a text provider: one tiny completion. */
async function oneToken(p: AiProvider, ctx: IntegrationContext): Promise<TestResult> {
  if (!ctx.secrets.has("apiKey")) return { ok: false, checks: [check("API key", false, "Save the API key first.")] };
  return probe(async () => {
    try {
      const r = await p.complete(ctx, { system: "Answer with one word.", prompt: "Say ok.", maxTokens: 5 });
      return [check("API key", true, `${p.describe().name.en} answered (model ${r.model}).`)];
    } catch (e) {
      if (e instanceof AiCallError) return [check("API key", false, e.kind === "key" ? `The provider refused the key: ${e.message}` : e.message)];
      throw e;
    }
  });
}

export class AnthropicIntegration extends BaseIntegration implements AiProvider {
  readonly spec = spec("ai.anthropic", "Claude (Anthropic)", "claude-sonnet-5-5", [
    { title: "Make a key", body: "In the Anthropic Console open API keys and create a key. Add a payment method or credits first: a Claude subscription does not include API use.", links: [{ label: "Anthropic Console", url: "https://console.anthropic.com/settings/keys" }] },
    { title: "Paste and test", body: "Paste the key here and press Test. Leave the model empty to use the default." },
  ]);
  models() { return ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const; }
  test(ctx: IntegrationContext) { return oneToken(this, ctx); }
  async complete(ctx: IntegrationContext, r: AiRequest): Promise<AiResponse> {
    const key = needKey(ctx);
    const model = r.model || ctx.config.model || "claude-sonnet-5-5";
    const res = await post(ctx, "https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" },
      { model, max_tokens: r.maxTokens, system: r.system, messages: [{ role: "user", content: r.prompt }] }, [key]);
    const j = (await res.json()) as { model?: string; stop_reason?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    if (j.stop_reason === "refusal") throw new AiCallError("request", "The AI couldn't answer this one. Try asking another way.");
    return { text: (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim(), inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0, model: j.model ?? model };
  }
}

export class OpenAiIntegration extends BaseIntegration implements AiProvider {
  readonly spec = spec("ai.openai", "OpenAI", "gpt-5-mini", [
    { title: "Make a key", body: "In the OpenAI platform open API keys and create a secret key. ChatGPT Plus does not include API use: add credits under Billing.", links: [{ label: "OpenAI API keys", url: "https://platform.openai.com/api-keys" }] },
    { title: "Paste and test", body: "Paste the key here and press Test. Type a model name only if you want a different one." },
  ]);
  models() { return ["gpt-5", "gpt-5-mini"] as const; }
  test(ctx: IntegrationContext) { return oneToken(this, ctx); }
  async complete(ctx: IntegrationContext, r: AiRequest): Promise<AiResponse> {
    const key = needKey(ctx);
    const model = r.model || ctx.config.model || "gpt-5-mini";
    const res = await post(ctx, "https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${key}` },
      { model, max_completion_tokens: r.maxTokens, messages: [{ role: "system", content: r.system }, { role: "user", content: r.prompt }] }, [key]);
    const j = (await res.json()) as { model?: string; choices?: { message?: { content?: string | null; refusal?: string | null } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const m = j.choices?.[0]?.message;
    if (m?.refusal) throw new AiCallError("request", "The AI couldn't answer this one. Try asking another way.");
    return { text: (m?.content ?? "").trim(), inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0, model: j.model ?? model };
  }
}

export class GeminiIntegration extends BaseIntegration implements AiProvider {
  readonly spec = spec("ai.gemini", "Google Gemini", "gemini-2.5-flash", [
    { title: "Make a key", body: "In Google AI Studio create an API key for a project with billing on.", links: [{ label: "Google AI Studio", url: "https://aistudio.google.com/apikey" }] },
    { title: "Paste and test", body: "Paste the key here and press Test." },
  ]);
  models() { return ["gemini-2.5-pro", "gemini-2.5-flash"] as const; }
  test(ctx: IntegrationContext) { return oneToken(this, ctx); }
  async complete(ctx: IntegrationContext, r: AiRequest): Promise<AiResponse> {
    const key = needKey(ctx);
    const model = r.model || ctx.config.model || "gemini-2.5-flash";
    if (!/^[a-z0-9.\-]{3,60}$/i.test(model)) throw new AiCallError("request", "The model name isn't valid.");
    const res = await post(ctx, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": key },
      { systemInstruction: { parts: [{ text: r.system }] }, contents: [{ role: "user", parts: [{ text: r.prompt }] }], generationConfig: { maxOutputTokens: r.maxTokens } }, [key]);
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }; modelVersion?: string };
    const c = j.candidates?.[0];
    if (!c || c.finishReason === "SAFETY") throw new AiCallError("request", "The AI couldn't answer this one. Try asking another way.");
    return { text: (c.content?.parts ?? []).map((p) => p.text ?? "").join("").trim(), inputTokens: j.usageMetadata?.promptTokenCount ?? 0, outputTokens: j.usageMetadata?.candidatesTokenCount ?? 0, model: j.modelVersion ?? model };
  }
}

export class ElevenLabsIntegration extends BaseIntegration implements VoiceProvider {
  readonly spec = spec("voice.elevenlabs", "ElevenLabs voice", "", [
    { title: "Make a key", body: "In ElevenLabs open your profile, API keys, and create a key with text to speech allowed.", links: [{ label: "ElevenLabs", url: "https://elevenlabs.io/app/settings/api-keys" }] },
    { title: "Choose a voice", body: "Copy the id of the voice to use (Voices, the voice's menu, Copy voice id), paste it with the key and press Test." },
  ], ["ai.voice"]);
  async test(ctx: IntegrationContext): Promise<TestResult> {
    const key = ctx.secrets.get("apiKey");
    if (!key) return { ok: false, checks: [check("API key", false, "Save the API key first.")] };
    return probe(async () => {
      const res = await ctx.fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
      if (!res.ok) return [check("API key", false, safeMessage(`ElevenLabs answered ${res.status}.`, [key]))];
      const j = (await res.json().catch(() => null)) as { voices?: { voice_id: string }[] } | null;
      const voice = ctx.config.voiceId;
      const checks = [check("API key", true, "ElevenLabs accepted the key.")];
      if (voice) checks.push(check("Voice", !!j?.voices?.some((v) => v.voice_id === voice), j?.voices?.some((v) => v.voice_id === voice) ? "The voice was found." : "That voice id isn't in this account."));
      return checks;
    });
  }
  async speak(ctx: IntegrationContext, r: SpeechRequest): Promise<SpeechResponse> {
    const key = needKey(ctx);
    const voice = r.voiceId || ctx.config.voiceId;
    if (!voice || !/^[A-Za-z0-9]{8,40}$/.test(voice)) throw new AiCallError("request", "Choose a voice id for this connection first.");
    const res = await post(ctx, `https://api.elevenlabs.io/v1/text-to-speech/${voice}`, { "xi-api-key": key, accept: "audio/mpeg" }, { text: r.text }, [key]);
    return { audio: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "audio/mpeg", characters: r.text.length };
  }
}
