// Which AI tools each plan gets, and each plan's monthly AI credits (Admin → AI).
// Where it fits: every AI route asks requireAiFeature() before it runs (lead finder in the business API, Ask AI on the
// website); aiClient() in lib/ai.ts reads the credit numbers from here; the admin API shows and saves them.
// How it works: AppSetting "ai.features" = { plans: { Starter: { credits, features: { lead_finder: true… } } }, askAi: true }.
// Nothing saved = every tool on and the credits the platform already used (AI_CREDITS). Usage is the existing AiUsage table
// (1 credit per 1,000 tokens), counted per month; -1 credits means unlimited.
// Rules: Ask AI on the website has no plan (visitors), so it is one switch for everyone (askAi).

import type { Prisma } from "@prisma/client";
import type { Db } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { AI_CREDITS, type AiSettings } from "../lib/ai.js";

/** Tools a business gets by plan. */
export const AI_FEATURES = ["listing_from_text", "lead_finder", "blog_writer", "reply_suggestions"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const AI_FEATURE_NAMES: Record<AiFeature, string> = { listing_from_text: "Listing from text", lead_finder: "Lead finder", blog_writer: "Blog writer", reply_suggestions: "Reply suggestions" };

export interface PlanAi { credits: number; features: Record<AiFeature, boolean> }
export interface AiFeatureSettings { askAi: boolean; plans: Record<string, PlanAi> }
type Stored = { askAi?: boolean; plans?: Record<string, { credits?: number; features?: Partial<Record<AiFeature, boolean>> }> };

const allOn = () => Object.fromEntries(AI_FEATURES.map((f) => [f, true])) as Record<AiFeature, boolean>;

/** All plans (from the plans table, plus the three default names), each with its switches and credits. */
export async function aiFeatureSettings(db: Db): Promise<AiFeatureSettings> {
  const [row, legacy, plans] = await Promise.all([
    db.appSetting.findUnique({ where: { key: "ai.features" } }), db.appSetting.findUnique({ where: { key: "ai" } }), db.plan.findMany({ select: { name: true } }),
  ]);
  const s = (row?.value ?? {}) as Stored;
  const old = ((legacy?.value ?? {}) as AiSettings).credits ?? {};
  const names = [...new Set([...Object.keys(AI_CREDITS), ...plans.map((p) => p.name)])];
  return {
    askAi: s.askAi !== false,
    plans: Object.fromEntries(names.map((n) => [n, { credits: s.plans?.[n]?.credits ?? old[n] ?? AI_CREDITS[n] ?? 500, features: { ...allOn(), ...(s.plans?.[n]?.features ?? {}) } }])),
  };
}

/** Saves a change. Credits are also written to the older "ai" setting, so the Setup center shows the same numbers. */
export async function saveAiFeatures(db: Db, next: AiFeatureSettings) {
  const value = next as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: "ai.features" }, create: { key: "ai.features", value }, update: { value } });
  const legacy = await db.appSetting.findUnique({ where: { key: "ai" } });
  const cur = (legacy?.value ?? {}) as AiSettings;
  const merged = { ...cur, credits: { ...(cur.credits ?? {}), ...Object.fromEntries(Object.entries(next.plans).map(([n, p]) => [n, p.credits])) } } as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: "ai" }, create: { key: "ai", value: merged }, update: { value: merged } });
}

/** Stops the request when the business's plan doesn't include this tool. */
export async function requireAiFeature(db: Db, planName: string, feature: AiFeature) {
  const s = await aiFeatureSettings(db);
  const p = s.plans[planName];
  if (p && p.features[feature] === false) throw new AppError(403, "ai_feature_off", `${AI_FEATURE_NAMES[feature]} isn't part of the ${planName} plan. Upgrade to use it.`);
}

/** Ask AI on the website is for everyone, so it has one switch. */
export async function requireAskAi(db: Db) {
  if (!(await aiFeatureSettings(db)).askAi) throw new AppError(503, "ai_off", "Ask AI isn't switched on yet.");
}

/** Credits used this month by each business, with its plan and limit. */
export async function usageByBusiness(db: Db, now = new Date()) {
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  const [sums, s] = await Promise.all([db.aiUsage.groupBy({ by: ["tenantId"], where: { tenantId: { not: null }, createdAt: { gte: since } }, _sum: { credits: true }, _count: { _all: true } }), aiFeatureSettings(db)]);
  const tenants = await db.tenant.findMany({ where: { id: { in: sums.map((x) => x.tenantId!) } }, select: { id: true, name: true, plan: { select: { name: true } } } });
  return sums.map((x) => {
    const t = tenants.find((y) => y.id === x.tenantId);
    return { tenantId: x.tenantId!, name: t?.name ?? "(removed)", plan: t?.plan.name ?? "", used: x._sum.credits ?? 0, calls: x._count._all, limit: s.plans[t?.plan.name ?? ""]?.credits ?? 0 };
  }).sort((a, b) => b.used - a.used);
}
