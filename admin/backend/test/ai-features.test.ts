import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { aiFeatureSettings, requireAiFeature, requireAskAi, usageByBusiness } from "@sheetal/backend-core/domain/ai-features";
import { aiClient } from "@sheetal/backend-core/lib/ai";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
let tenantId = "";
const call = (who: string, method: "GET" | "PUT", url: string, body?: object) => app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, ai_usage RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, role] of [["boss", "super_admin"], ["ops", "operations"], ["owner", null]] as const) {
    const u = await db.user.create({ data: { email: `${k}@sheetal.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
    if (k === "owner") tenantId = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: u.id, name: "Lakeside Hotel", type: "hotel", planId: "hotel-business" }))).id;
  }
});
afterAll(async () => { await app.close(); });

describe("AI features by plan", () => {
  it("start with every tool on and the credits the platform already used", async () => {
    expect((await call("ops", "GET", "/admin/ai/features")).statusCode).toBe(403);
    expect((await call("owner", "GET", "/admin/ai/features")).statusCode).toBe(403);
    const d = (await call("boss", "GET", "/admin/ai/features")).json().data;
    expect(d.askAi).toBe(true);
    expect(d.plans.Starter.credits).toBe(500);
    expect(d.plans.Business.credits).toBe(2000);
    expect(d.plans.Pro.credits).toBe(6000);
    expect(Object.values(d.plans.Starter.features)).toEqual([true, true, true, true]);
    expect(d.features.map((f: { id: string }) => f.id)).toEqual(["listing_from_text", "lead_finder", "blog_writer", "reply_suggestions"]);
  });

  it("refuse unknown plans, tools and silly credits", async () => {
    expect((await call("boss", "PUT", "/admin/ai/features", { plans: { Gold: { credits: 5 } } })).statusCode).toBe(400);
    expect((await call("boss", "PUT", "/admin/ai/features", { plans: { Starter: { features: { magic: true } } } })).statusCode).toBe(422);
    expect((await call("boss", "PUT", "/admin/ai/features", { plans: { Starter: { credits: -2 } } })).statusCode).toBe(422);
    expect((await call("boss", "PUT", "/admin/ai/features", { plans: { Starter: { credits: 1.5 } } })).statusCode).toBe(422);
    expect((await call("ops", "PUT", "/admin/ai/features", { askAi: false })).statusCode).toBe(403);
  });

  it("save switches and credits, audit each change, and keep the older AI credits in step", async () => {
    const r = await call("boss", "PUT", "/admin/ai/features", { askAi: false, plans: { Starter: { features: { lead_finder: false } }, Business: { credits: 3000 } } });
    expect(r.statusCode).toBe(200);
    const t = (await app.db!.auditLog.findMany({ where: { action: "ai.features" } })).map((a) => a.target).sort();
    expect(t).toEqual(["Business.credits: 2000 → 3000", "Starter.lead_finder: on → off", "askAi: on → off"]);
    const d = (await call("boss", "GET", "/admin/ai/features")).json().data;
    expect(d.plans.Starter.features.lead_finder).toBe(false);
    expect(d.plans.Business.credits).toBe(3000);
    expect((await app.db!.appSetting.findUniqueOrThrow({ where: { key: "ai" } })).value).toMatchObject({ credits: { Business: 3000 } });
    const ai = await aiClient(app.db!, new Vault(app.config.SECRETS_KEY, false), { ANTHROPIC_API_KEY: "sk-test" });
    expect(ai?.credits).toMatchObject({ Starter: 500, Business: 3000, Pro: 6000 });
    expect((await call("boss", "PUT", "/admin/ai/features", { plans: { Business: { credits: 3000 } } })).json().message).toBe("Nothing changed.");
  });

  it("stop a tool the plan doesn't include, and Ask AI when it is off", async () => {
    await expect(requireAiFeature(app.db!, "Starter", "lead_finder")).rejects.toMatchObject({ statusCode: 403, code: "ai_feature_off" });
    await expect(requireAiFeature(app.db!, "Starter", "blog_writer")).resolves.toBeUndefined();
    await expect(requireAiFeature(app.db!, "Business", "lead_finder")).resolves.toBeUndefined();
    await expect(requireAiFeature(app.db!, "Some other plan", "lead_finder")).resolves.toBeUndefined(); // unknown plan names are not blocked
    await expect(requireAskAi(app.db!)).rejects.toMatchObject({ statusCode: 503 });
    await call("boss", "PUT", "/admin/ai/features", { askAi: true });
    await expect(requireAskAi(app.db!)).resolves.toBeUndefined();
  });

  it("show credits changed in the Setup center on this page too", async () => {
    expect((await call("boss", "PUT", "/admin/settings/ai", { enabled: true, model: "claude-opus-5-5", credits: { Pro: 9000 } })).statusCode).toBe(200);
    expect((await aiFeatureSettings(app.db!)).plans.Pro.credits).toBe(9000);
    expect((await call("boss", "GET", "/admin/settings/ai")).json().data.credits).toMatchObject({ Pro: 9000, Business: 3000 });
  });

  it("count this month's use per business, with plan and limit", async () => {
    const db = app.db!;
    const row = (credits: number, createdAt?: Date) => db.aiUsage.create({ data: { tenantId, feature: "extract_leads", model: "x", inputTok: 1, outputTok: 1, credits, ...(createdAt ? { createdAt } : {}) } });
    await row(5); await row(7);
    const now = new Date();
    await row(100, new Date(now.getFullYear(), now.getMonth() - 1, 15)); // last month does not count
    const u = await usageByBusiness(db);
    expect(u).toEqual([{ tenantId, name: "Lakeside Hotel", plan: "Business", used: 12, calls: 2, limit: 3000 }]);
    expect((await call("boss", "GET", "/admin/ai/usage")).json().data).toEqual(u);
  });
});
