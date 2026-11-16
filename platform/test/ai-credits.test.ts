// Tests for Sheetal AI credits and the AI router (P3-BE-8; MARKETPLACE-AND-BILLING.md section 10; PHASE-3-TEST-PLAN.md suite 12): spending
// first-expiring first, twenty calls at once never overspend, the monthly allowance once, locked previews with no model call, the credits of
// the largest answer taken before the call and the rest given back, a failed call costs nothing, own keys take no credits and fail clearly,
// the owner's fallback switch, and keys never appear in an answer, an error, a usage row or a log line.
// Where it fits: platform/src/billing/ai-credits.ts and platform/src/ai/router.ts on the suite's throwaway PostgreSQL, with a fake fetch.
// Run with: npm run test -w @sheetal/platform
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../src/db/client.js";
import { addGrant, aiAllowance, creditBalance, creditsFor, giveBack, spend } from "../src/billing/ai-credits.js";
import { aiStateFor, chooseRoute, runAi, type AiDeps } from "../src/ai/router.js";
import { SEED_AI } from "../src/billing/catalog.seed.js";
import type { IntegrationContext } from "../src/integrations/types.js";
import { testDb } from "./expense-fixture.js";

let db: Db;
const DAY = 864e5;
const KEY = "sk-own-THISKEYMUSTNEVERLEAK-1234567890";
const SHEETAL_KEY = "sk-sheetal-ALSONEVERSHOWN-0987654321";
const lines: string[] = [];
const log = { info: (...a: unknown[]) => lines.push(JSON.stringify(a)), warn: (...a: unknown[]) => lines.push(JSON.stringify(a)), error: (...a: unknown[]) => lines.push(JSON.stringify(a)), debug: () => undefined } as unknown as FastifyBaseLogger;

async function business(): Promise<string> {
  await db.$executeRawUnsafe(`INSERT INTO plans (id, type, name, price, limits, features) VALUES ('ai-plan', 'hotel', 'Business', 1500, '{}', '{}') ON CONFLICT DO NOTHING`);
  const id = `ai-${randomUUID().slice(0, 8)}`;
  await db.$executeRawUnsafe(`INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ($1, 'AI Hotel', 'hotel', 'ai-plan', now())`, id);
  return id;
}

/** A provider answer: Anthropic's shape, or an error status. Counts the calls. */
function provider(o: { status?: number; tokens?: [number, number]; echoKey?: string }) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(String(url));
    if (o.status && o.status !== 200) return new Response(JSON.stringify({ error: { message: `invalid x-api-key ${o.echoKey ?? ""}` } }), { status: o.status });
    if (String(url).includes("openai")) return Response.json({ model: "gpt-test", choices: [{ message: { content: "own answer" } }], usage: { prompt_tokens: o.tokens?.[0] ?? 900, completion_tokens: o.tokens?.[1] ?? 600 } });
    return Response.json({ model: "claude-test", content: [{ type: "text", text: "sheetal answer" }], usage: { input_tokens: o.tokens?.[0] ?? 900, output_tokens: o.tokens?.[1] ?? 600 } });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}
const ctx = (key: string, f: typeof globalThis.fetch): IntegrationContext => ({
  connection: {} as never, config: { model: "" }, mode: "live", env: "test", fetch: f, log, now: new Date(),
  secrets: { get: (k) => (k === "apiKey" ? key : undefined), has: (k) => k === "apiKey" },
});
/** Router deps: which connections are live (platform = Sheetal AI, business = own key). */
function deps(o: { platform?: ReturnType<typeof provider>; own?: { id: string; p: ReturnType<typeof provider> } }): AiDeps {
  return {
    db, log,
    integrations: { contextFor: async (owner, id) => {
      if (owner.scope === "platform" && o.platform && id === "ai.anthropic") return ctx(SHEETAL_KEY, o.platform.fetch);
      if (owner.scope === "business" && o.own && id === o.own.id) return ctx(KEY, o.own.p.fetch);
      return null;
    } },
  };
}
const RUN = { appId: "crm", feature: "summary", capability: "text" as const, system: "Be brief.", prompt: "Summarise this customer.", maxTokens: 2000, preview: "A sample summary." };

beforeAll(() => { db = testDb(); });
afterAll(async () => { await db.$disconnect(); });

describe("credits", () => {
  it("cost by 1,000 tokens (at least 1) and voice by started minute", () => {
    expect(creditsFor(SEED_AI.creditRates, "text", { tokens: 0 })).toBe(1);
    expect(creditsFor(SEED_AI.creditRates, "text", { tokens: 1500 })).toBe(2);
    expect(creditsFor(SEED_AI.creditRates, "vision", { tokens: 1500 })).toBe(4);
    expect(creditsFor(SEED_AI.creditRates, "voice", { seconds: 61 })).toBe(10);
  });

  it("spends first-expiring first, never an expired grant, and gives back exactly what it took", async () => {
    const t = await business();
    const now = new Date();
    const late = await addGrant(db, { tenantId: t, credits: 100, source: "topup", expiresAt: new Date(now.getTime() + 60 * DAY) });
    const soon = await addGrant(db, { tenantId: t, credits: 50, source: "plan", expiresAt: new Date(now.getTime() + 5 * DAY) });
    await addGrant(db, { tenantId: t, credits: 500, source: "gift", expiresAt: new Date(now.getTime() - DAY) });
    expect(await creditBalance(db, t, now)).toBe(150);
    const taken = await db.$transaction((tx) => spend(tx, { tenantId: t, credits: 70, now }));
    expect(taken).toEqual([{ grantId: soon.id, credits: 50 }, { grantId: late.id, credits: 20 }]);
    expect(await creditBalance(db, t, now)).toBe(80);
    await db.$transaction((tx) => giveBack(tx, taken, 30));
    expect((await db.aiCreditGrant.findUniqueOrThrow({ where: { id: late.id } })).remaining).toBe(100);
    expect((await db.aiCreditGrant.findUniqueOrThrow({ where: { id: soon.id } })).remaining).toBe(10);
    await expect(db.$transaction((tx) => spend(tx, { tenantId: t, credits: 111, now }))).rejects.toMatchObject({ statusCode: 402, code: "ai_credits_used" });
  });

  it("twenty calls at once never take more than there is", async () => {
    const t = await business();
    const now = new Date();
    await addGrant(db, { tenantId: t, credits: 60, source: "plan", expiresAt: new Date(now.getTime() + 3 * DAY) });
    await addGrant(db, { tenantId: t, credits: 40, source: "topup", expiresAt: new Date(now.getTime() + 9 * DAY) });
    const r = await Promise.allSettled(Array.from({ length: 20 }, () => db.$transaction((tx) => spend(tx, { tenantId: t, credits: 7, now }), { maxWait: 30_000, timeout: 30_000 })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(14); // 14 x 7 = 98 of 100
    expect(await creditBalance(db, t, now)).toBe(2);
  });

  it("the monthly allowance of a Sheetal AI plan is added once per month, expiring at the month's end within the period", async () => {
    const t = await business();
    const start = new Date("2030-01-10T00:00:00Z"), end = new Date("2031-01-10T00:00:00Z");
    const o = { tenantId: t, planKey: "plus", periodStart: start, periodEnd: end, catalog: SEED_AI, now: new Date("2030-03-15T00:00:00Z") };
    expect((await aiAllowance(db, o)).created).toBe(true);
    expect((await aiAllowance(db, o)).created).toBe(false);
    const g = await db.aiCreditGrant.findMany({ where: { tenantId: t } });
    expect(g).toEqual([expect.objectContaining({ credits: 4_000, source: "plan", expiresAt: new Date("2030-04-10T00:00:00Z") })]);
    expect((await aiAllowance(db, { ...o, now: new Date("2030-04-11T00:00:00Z") })).created).toBe(true);
    expect((await aiAllowance(db, { ...o, planKey: "nope" })).created).toBe(false);
  });
});

describe("the AI router", () => {
  it("chooses own key (preferred first), else Sheetal AI with credits, else locked; Sheetal can switch own keys off", () => {
    expect(chooseRoute({ own: ["ai.openai", "ai.gemini"], preferred: "ai.gemini", allowOwnKeys: true, balance: 0, sheetalReady: false })).toEqual({ state: "own_key", order: ["ai.gemini", "ai.openai"] });
    expect(chooseRoute({ own: ["ai.openai"], preferred: "auto", allowOwnKeys: false, balance: 5, sheetalReady: true }).state).toBe("sheetal");
    expect(chooseRoute({ own: [], preferred: "auto", allowOwnKeys: true, balance: 5, sheetalReady: false }).state).toBe("locked");
    expect(chooseRoute({ own: [], preferred: "auto", allowOwnKeys: true, balance: 0, sheetalReady: true }).state).toBe("locked");
  });

  it("locked: the preview, no model call, a preview usage row with 0 credits", async () => {
    const t = await business();
    const p = provider({});
    const r = await runAi(deps({ platform: p }), { ...RUN, tenantId: t });
    expect(r).toEqual({ state: "locked", preview: "A sample summary." });
    expect(p.calls).toHaveLength(0);
    expect(await db.aiUsage.findMany({ where: { tenantId: t } })).toEqual([expect.objectContaining({ source: "preview", credits: 0, appId: "crm" })]);
  });

  it("Sheetal AI: takes what the answer used; a call that can't be covered never reaches the provider", async () => {
    const t = await business();
    await addGrant(db, { tenantId: t, credits: 10, source: "trial", expiresAt: new Date(Date.now() + DAY) });
    const p = provider({ tokens: [900, 600] });
    const r = await runAi(deps({ platform: p }), { ...RUN, tenantId: t });
    expect(r).toMatchObject({ state: "sheetal", text: "sheetal answer", provider: "ai.anthropic", credits: 2, balance: 8 });
    expect(await db.aiUsage.findFirst({ where: { tenantId: t, source: "sheetal" } })).toMatchObject({ credits: 2, provider: "ai.anthropic", inputTok: 900, outputTok: 600 });
    // 20,000 tokens could cost 21 credits: refused before any call.
    await expect(runAi(deps({ platform: p }), { ...RUN, tenantId: t, maxTokens: 20_000 })).rejects.toMatchObject({ statusCode: 402, code: "ai_credits_used" });
    expect(p.calls).toHaveLength(1);
    expect(await creditBalance(db, t)).toBe(8);
  });

  it("a failed Sheetal AI call gives every credit back", async () => {
    const t = await business();
    await addGrant(db, { tenantId: t, credits: 10, source: "trial", expiresAt: new Date(Date.now() + DAY) });
    const p = provider({ status: 500 });
    await expect(runAi(deps({ platform: p }), { ...RUN, tenantId: t })).rejects.toMatchObject({ statusCode: 503, code: "ai_off" });
    expect(p.calls).toHaveLength(1);
    expect(await creditBalance(db, t)).toBe(10);
  });

  it("own key: no credits taken; when it fails, a clear message unless the owner allowed Sheetal AI as the fallback", async () => {
    const t = await business();
    await addGrant(db, { tenantId: t, credits: 10, source: "gift", expiresAt: new Date(Date.now() + DAY) });
    const good = provider({});
    const r = await runAi(deps({ platform: provider({}), own: { id: "ai.openai", p: good } }), { ...RUN, tenantId: t });
    expect(r).toMatchObject({ state: "own_key", provider: "ai.openai", text: "own answer", credits: 0 });
    expect(await creditBalance(db, t)).toBe(10);
    expect(await db.aiUsage.findFirst({ where: { tenantId: t, source: "own" } })).toMatchObject({ own: true, provider: "ai.openai" });
    expect((await aiStateFor(deps({ own: { id: "ai.openai", p: good } }), t)).state).toBe("own_key");

    const bad = provider({ status: 401, echoKey: KEY });
    const sheetal = provider({});
    const e = await runAi(deps({ platform: sheetal, own: { id: "ai.openai", p: bad } }), { ...RUN, tenantId: t }).catch((x: Error & { code?: string }) => x);
    expect(e).toMatchObject({ statusCode: 503, code: "ai_key" });
    expect(sheetal.calls).toHaveLength(0);
    expect(await creditBalance(db, t)).toBe(10);

    await db.appSetting.create({ data: { key: `t:${t}:business.ai`, value: { preferred: "auto", fallbackToSheetal: true } } });
    const r2 = await runAi(deps({ platform: sheetal, own: { id: "ai.openai", p: bad } }), { ...RUN, tenantId: t });
    expect(r2).toMatchObject({ state: "sheetal", credits: 2 });
    expect(await creditBalance(db, t)).toBe(8);

    // Keys never appear anywhere: the error, the answers, the usage rows, the log lines.
    const everything = JSON.stringify([e instanceof Error ? e.message : e, r, r2, await db.aiUsage.findMany({ where: { tenantId: t } }), lines]);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(SHEETAL_KEY);
    expect(everything).not.toContain("THISKEYMUSTNEVERLEAK");
  });
});
