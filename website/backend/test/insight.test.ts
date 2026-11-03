import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import type { AiClient } from "@sheetal/backend-core/lib/ai";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let asked: { system?: string; messages?: { content: string }[] } = {};
// The AI, faked: records what it was sent.
const ai = { model: "claude-opus-5-5", client: { beta: { messages: { create: async (req: typeof asked) => { asked = req; return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 200 }, content: [{ type: "text", text: "SP-0001 is better value." }] }; } } } } as unknown as AiClient };
const BROWSER = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", "accept-language": "en" };

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "website"), { ai });
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, listings, page_views, bot_days, ai_usage RESTART IDENTITY CASCADE`);
  await db.listing.create({ data: { code: "SP-0001", slug: "a", purpose: "sale", category: "House", title: "House in Dhapasi", status: "published", price: 30_000_000n, private: { owner_phone: "9800000000" } } });
  await db.listing.create({ data: { code: "SP-0002", slug: "b", purpose: "sale", category: "House", title: "House in Kapan", status: "published", price: 25_000_000n } });
});
afterAll(async () => { await app.close(); });

describe("Ask AI", () => {
  it("compares listings by code using public facts only", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/ask-ai", payload: { property_codes: ["SP-0001", "2"], question: "Which is better?" } });
    expect(r.json()).toMatchObject({ status: 200, summary: "SP-0001 is better value." });
    expect(asked.messages![0]!.content).toContain("House in Kapan");
    expect(asked.messages![0]!.content).not.toContain("9800000000"); // private owner details never go to the AI
    expect(await app.db!.aiUsage.count({ where: { feature: "compare" } })).toBe(1);
    expect((await app.inject({ method: "POST", url: "/v1/ask-ai", payload: { property_codes: ["SP-9999"] } })).statusCode).toBe(400);
  });
});

describe("visits", () => {
  it("stores people's page views and only counts bots", async () => {
    const visit = (headers: Record<string, string>, entity_id: number | null = 1) => app.inject({ method: "POST", url: "/v1/track-visit", headers, payload: { session_id: "abcdef123456", page_url: "/property/a?utm=x", page_type: "property", entity_id, referrer: "https://www.facebook.com/some/path?id=1" } });
    expect((await visit(BROWSER)).statusCode).toBe(204);
    expect((await visit({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" })).statusCode).toBe(204);
    expect((await visit({ "user-agent": "python-requests/2.31" })).statusCode).toBe(204);
    const views = await app.db!.pageView.findMany();
    expect(views).toEqual([expect.objectContaining({ path: "/property/a", listingId: 1, referrer: "www.facebook.com" })]);
    expect(views[0]!.session).not.toBe("abcdef123456");
    const bots = await app.db!.botDay.findMany();
    expect(Object.fromEntries(bots.map((b) => [b.kind, b.count]))).toEqual({ search_engine: 1, bot: 1 });
  });
});
