// Sheetal AI credits (MARKETPLACE-AND-BILLING.md section 10.3; P3-BE-8): the balance, spending oldest-expiry first, giving back what a failed
// call did not use, and adding grants (the monthly allowance, a top-up, a trial, a staff gift, a moved plan).
// Where it fits: the AI router (platform/src/ai/router.ts) reserves credits before a model call and settles after it; the lifecycle job adds
// the monthly allowance (aiAllowance); Admin -> Businesses gives credits; GET /v1/ai/credits shows the balance.
// How it works: a grant is an AiCreditGrant row (credits, remaining, expiresAt). Balance = the sum of `remaining` of grants not yet expired.
// spend() runs in the caller's transaction: it locks the business's live grants (SELECT ... FOR UPDATE, first-expiring first) and takes from
// them in that order, so twenty calls at once can never take more than there is (the database also refuses remaining < 0). It returns what
// it took from which grant, so giveBack() can return exactly that, in the same request, when the provider call fails or used less.
// Rules: credits are whole numbers; a call costs at least 1. Own-key calls never come here. Expired credits are never spent or given back
// into (giving back to an expired grant just leaves it expired).

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AppError } from "../core/errors.js";
import type { Db } from "../db/client.js";
import type { AiCatalog } from "./types.js";

type Tx = Prisma.TransactionClient;
export type Capability = "text" | "vision" | "voice";
export interface Taken { grantId: string; credits: number }
/** The subscription row that holds a business's Sheetal AI plan (editionId = the plan key: lite, plus, max). */
export const AI_PLAN_APP = "sheetal_ai";
export type GrantSource = "plan" | "topup" | "trial" | "migration" | "gift" | "refund";

/** Credits a call costs: text and vision by 1,000 tokens (at least 1), voice by started minute (catalog.ai.creditRates). */
export function creditsFor(rates: AiCatalog["creditRates"], capability: Capability, use: { tokens?: number; seconds?: number }): number {
  if (capability === "voice") return Math.max(1, Math.ceil((use.seconds ?? 0) / 60) * rates.voicePerMinute);
  const per = capability === "vision" ? rates.vision : rates.text;
  return Math.max(1, Math.ceil((use.tokens ?? 0) / 1000) * per);
}

/** Credits a business can spend now. */
export async function creditBalance(db: Db | Tx, tenantId: string, now: Date = new Date()): Promise<number> {
  const r = await db.aiCreditGrant.aggregate({ where: { tenantId, remaining: { gt: 0 }, expiresAt: { gt: now } }, _sum: { remaining: true } });
  return r._sum.remaining ?? 0;
}

/** Takes `credits` from the business's grants, first-expiring first, inside the caller's transaction. 402 ai_credits_used when short. */
export async function spend(tx: Tx, o: { tenantId: string; credits: number; now: Date }): Promise<Taken[]> {
  if (!Number.isInteger(o.credits) || o.credits < 1) throw new Error("spend: credits must be a whole number above 0");
  const rows = await tx.$queryRaw<{ id: string; remaining: number }[]>`
    SELECT id, remaining FROM ai_credit_grants
    WHERE tenant_id = ${o.tenantId} AND remaining > 0 AND expires_at > ${o.now}
    ORDER BY expires_at ASC, created_at ASC, id ASC FOR UPDATE`;
  const have = rows.reduce((a, r) => a + r.remaining, 0);
  if (have < o.credits) {
    throw new AppError(402, "ai_credits_used", have === 0 ? "Your Sheetal AI credits are used up. Add a top-up or connect your own AI key." : `This needs ${o.credits} AI credits and ${have} are left. Add a top-up or connect your own AI key.`, undefined, { needed: o.credits, left: have });
  }
  const taken: Taken[] = [];
  let left = o.credits;
  for (const r of rows) {
    if (left === 0) break;
    const n = Math.min(left, r.remaining);
    await tx.aiCreditGrant.update({ where: { id: r.id }, data: { remaining: { decrement: n } } });
    taken.push({ grantId: r.id, credits: n });
    left -= n;
  }
  return taken;
}

/** Gives back `credits` of what spend() took (the last grants first, so the earliest-expiring stay spent). Returns what is still taken. */
export async function giveBack(tx: Tx, taken: readonly Taken[], credits: number): Promise<Taken[]> {
  const out = taken.map((t) => ({ ...t }));
  let left = Math.min(credits, out.reduce((a, t) => a + t.credits, 0));
  for (let i = out.length - 1; i >= 0 && left > 0; i--) {
    const n = Math.min(left, out[i]!.credits);
    await tx.aiCreditGrant.update({ where: { id: out[i]!.grantId }, data: { remaining: { increment: n } } });
    out[i]!.credits -= n;
    left -= n;
  }
  return out.filter((t) => t.credits > 0);
}

/** Adds a grant. With `ref`, a second call with the same ref adds nothing (the allowance job and imports may run twice). */
export async function addGrant(db: Db | Tx, o: { tenantId: string; credits: number; source: GrantSource; expiresAt: Date; ref?: string }) {
  if (o.ref) {
    const had = await db.aiCreditGrant.findFirst({ where: { tenantId: o.tenantId, ref: o.ref } });
    if (had) return { created: false, id: had.id };
  }
  const g = await db.aiCreditGrant.create({ data: { id: randomUUID(), tenantId: o.tenantId, credits: o.credits, remaining: o.credits, source: o.source, expiresAt: o.expiresAt, ref: o.ref ?? null } });
  return { created: true, id: g.id };
}

/** The monthly allowance of a Sheetal AI plan (a subscription with appId AI_PLAN_APP, editionId = the plan key) for its current period:
 *  one grant per period, expiring at the period end. Called by the lifecycle job; safe to call again. */
export async function aiAllowance(db: Db, o: { tenantId: string; planKey: string; periodStart: Date; periodEnd: Date; catalog: AiCatalog | undefined; now: Date }) {
  const plan = o.catalog?.plans.find((p) => p.key === o.planKey);
  if (!plan || plan.creditsPerMonth < 1 || o.periodEnd <= o.now) return { created: false };
  // A yearly plan gets its allowance month by month: the grant covers the month of `now` inside the period.
  const monthStart = new Date(o.periodStart);
  while (new Date(monthStart).setUTCMonth(monthStart.getUTCMonth() + 1) <= o.now.getTime()) monthStart.setUTCMonth(monthStart.getUTCMonth() + 1);
  const monthEnd = new Date(monthStart); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const expiresAt = monthEnd < o.periodEnd ? monthEnd : o.periodEnd;
  return addGrant(db, { tenantId: o.tenantId, credits: plan.creditsPerMonth, source: "plan", expiresAt, ref: `allowance:${o.planKey}:${monthStart.toISOString().slice(0, 10)}` });
}
