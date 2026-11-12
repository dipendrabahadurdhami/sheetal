// Admin → AI: which AI tools each plan gets, each plan's monthly credits, and who is using them.
// Where it fits: the AI page in the admin panel (the keys and model stay in the Setup center).
// How it works: GET shows the switches and credits per plan plus this month's use per business; PUT changes them. The
// AI routes ask domain/ai-features.ts before they run, and aiClient() reads the credits from the same place.
// Rules: settings.platform for everything; unknown plans or tools are refused; -1 credits means unlimited; every change is audited.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest } from "@sheetal/platform/core/errors";
import { AI_FEATURES, AI_FEATURE_NAMES, aiFeatureSettings, saveAiFeatures, usageByBusiness } from "@sheetal/backend-core/domain/ai-features";
import { staffOf } from "./routes.js";

const body = z.strictObject({
  askAi: z.boolean(),
  plans: z.record(z.string().max(60), z.strictObject({
    credits: z.number().int().min(-1, "Use -1 for unlimited.").max(10_000_000),
    features: z.strictObject(Object.fromEntries(AI_FEATURES.map((f) => [f, z.boolean()]))).partial(),
  }).partial()),
}).partial();

export async function adminAiFeatureRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  app.get("/admin/ai/features", async (request) => {
    staffOf(request, "platform.settings.read+platform.settings.update");
    return { data: { ...(await aiFeatureSettings(db())), features: AI_FEATURES.map((id) => ({ id, name: AI_FEATURE_NAMES[id] })) } };
  });

  app.put("/admin/ai/features", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    const b = body.parse(request.body);
    const cur = await aiFeatureSettings(db());
    const unknown = Object.keys(b.plans ?? {}).filter((n) => !cur.plans[n]);
    if (unknown.length) throw badRequest(`There is no plan called ${unknown[0]}.`);
    const next = structuredClone(cur);
    if (b.askAi !== undefined) next.askAi = b.askAi;
    for (const [n, p] of Object.entries(b.plans ?? {})) {
      if (p.credits !== undefined) next.plans[n]!.credits = p.credits;
      for (const [f, on] of Object.entries(p.features ?? {})) next.plans[n]!.features[f as (typeof AI_FEATURES)[number]] = on as boolean;
    }
    const changes: string[] = [];
    if (next.askAi !== cur.askAi) changes.push(`askAi: ${cur.askAi ? "on" : "off"} → ${next.askAi ? "on" : "off"}`);
    for (const n of Object.keys(next.plans)) {
      if (next.plans[n]!.credits !== cur.plans[n]!.credits) changes.push(`${n}.credits: ${cur.plans[n]!.credits} → ${next.plans[n]!.credits}`);
      for (const f of AI_FEATURES) if (next.plans[n]!.features[f] !== cur.plans[n]!.features[f]) changes.push(`${n}.${f}: ${cur.plans[n]!.features[f] ? "on" : "off"} → ${next.plans[n]!.features[f] ? "on" : "off"}`);
    }
    if (!changes.length) return { message: "Nothing changed.", data: cur };
    await saveAiFeatures(db(), next);
    for (const c of changes) await db().auditLog.create({ data: { actorId: s.user.id, action: "ai.features", target: c, ip: request.ip } });
    return { message: "Saved.", data: next };
  });

  app.get("/admin/ai/usage", async (request) => {
    staffOf(request, "platform.settings.read+platform.settings.update");
    return { data: await usageByBusiness(db()) };
  });
}
