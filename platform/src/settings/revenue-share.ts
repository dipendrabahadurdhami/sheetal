// The revenue-share rule: how much of an online payment is Sheetal's commission and how much of that goes to the technology partner (SETTINGS.md section 6).
// Where it fits: defs.ts stores the setting "platform.revenueShare"; revenue.ts (the report) and, from Phase 3, the code that records a payment use
// commissionFor() and partnerShareOf(). Pure: no database.
// Rules: money is whole paisa (integers). Rounding is to the nearest paisa, half up. The order is: the gateway's rate, else the app's rate, else the default.
// A change never rewrites earlier days: it applies from `effectiveFrom` (a Nepal date), and what was recorded on a payment stays as recorded.

import { z } from "zod";

const pct = z.number().min(0).max(100).refine((n) => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-9, "Use at most 2 decimals.");
const id = z.string().regex(/^[a-z][a-z0-9_.]{1,40}$/, "Use an app or integration id.");

export const RevenueShare = z.object({
  commissionPct: pct,
  perApp: z.record(id, pct).default({}),
  perGateway: z.record(id, pct).default({}),
  technologyPartner: z.object({
    enabled: z.boolean(),
    name: z.string().trim().max(120).default(""),
    sharePct: pct,
    appliesTo: z.enum(["all", "listed"]).default("all"),
    apps: z.array(id).max(60).default([]),
  }).strict(),
  rounding: z.literal("nearest_paisa").default("nearest_paisa"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-12."),
}).strict();
export type RevenueShare = z.infer<typeof RevenueShare>;

/** 10% is the figure in use today (payout fee 1000 hundredths of a percent). The partner split starts switched off. */
export const REVENUE_SHARE_DEFAULT: RevenueShare = {
  commissionPct: 10, perApp: {}, perGateway: {},
  technologyPartner: { enabled: false, name: "", sharePct: 0, appliesTo: "all", apps: [] },
  rounding: "nearest_paisa", effectiveFrom: "2026-01-01",
};

/** percent of an amount in paisa, rounded to the nearest paisa (half up), without floating-point drift. */
export function pctOf(paisa: number, percent: number): number {
  if (!Number.isSafeInteger(paisa)) throw new Error("Money must be whole paisa.");
  const hundredths = Math.round(percent * 100);                 // 12.5% -> 1250
  const sign = paisa < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(paisa) * hundredths + 5000) / 10000);
}

/** The rate for one payment: gateway override, else app override, else the default. */
export function rateFor(s: RevenueShare, o: { appId?: string | null; gatewayId?: string | null } = {}): number {
  if (o.gatewayId && Object.hasOwn(s.perGateway, o.gatewayId)) return s.perGateway[o.gatewayId]!;
  if (o.appId && Object.hasOwn(s.perApp, o.appId)) return s.perApp[o.appId]!;
  return s.commissionPct;
}

/** Sheetal's commission on a payment. Only live payments taken through Sheetal's own gateway count; anything else is 0. */
export function commissionFor(s: RevenueShare, o: { amountPaisa: number; appId?: string | null; gatewayId?: string | null; live: boolean; viaPlatform: boolean }): { pct: number; commissionPaisa: number } {
  if (!o.live || !o.viaPlatform) return { pct: 0, commissionPaisa: 0 };
  const p = rateFor(s, o);
  return { pct: p, commissionPaisa: pctOf(o.amountPaisa, p) };
}

/** The technology partner's part of a commission (0 when the split is off, not yet in force on that day, or the app is not listed). */
export function partnerShareOf(s: RevenueShare, o: { commissionPaisa: number; appId?: string | null; day: string }): number {
  const t = s.technologyPartner;
  if (!t.enabled || o.day < s.effectiveFrom) return 0;
  if (t.appliesTo === "listed" && !(o.appId && t.apps.includes(o.appId))) return 0;
  return pctOf(o.commissionPaisa, t.sharePct);
}
