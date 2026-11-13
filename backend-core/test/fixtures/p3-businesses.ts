// Phase 3 fixtures (P3-QA-1): one business per type × Starter / Business / Pro, plus the add-on and status cases the parity and migration
// tests need. Plans come from the real seed (domain/plans.ts), so a change there shows up here.
// Where it fits: backend-core/test/entitlements-contract.test.ts (P3-BE-3) and the migration tests (P3-BE-10).
// Rules: data only.
import { PLANS, type PlanDef } from "../../src/domain/plans.js";

export const TYPES = ["hotel", "host", "developer", "agency", "sponsor"] as const;
export type FixtureStatus = "active" | "trial" | "past_due" | "suspended" | "cancelled" | "demo";

export interface P3Business {
  name: string;
  type: (typeof TYPES)[number];
  plan: PlanDef;
  status: FixtureStatus;
  /** Bought add-ons that raise old limits (TenantAddon), by old key. */
  extra: Record<string, number>;
}

const planOf = (type: string, name: PlanDef["name"]) => PLANS.find((p) => p.type === type && p.name === name)!;

export const P3_BUSINESSES: P3Business[] = [
  ...TYPES.flatMap((type) => (["Starter", "Business", "Pro"] as const).map((n) => ({ name: `${type} ${n}`, type, plan: planOf(type, n), status: "active" as const, extra: {} }))),
  { name: "hotel Business with 5 more seats and 10 more rooms", type: "hotel", plan: planOf("hotel", "Business"), status: "active", extra: { seats: 5, rooms: 10 } },
  { name: "agency Business in trial", type: "agency", plan: planOf("agency", "Business"), status: "trial", extra: {} },
  { name: "developer Business past due", type: "developer", plan: planOf("developer", "Business"), status: "past_due", extra: {} },
  { name: "sponsor Business suspended (skipped by the migration)", type: "sponsor", plan: planOf("sponsor", "Business"), status: "suspended", extra: {} },
];

/** The plan's limits raised by add-ons, as effectiveLimits() gives them (-1 stays unlimited). */
export const limitsOf = (b: P3Business): Record<string, number> => {
  const out: Record<string, number> = { ...b.plan.limits };
  for (const [k, n] of Object.entries(b.extra)) if (out[k] !== undefined && out[k] !== -1) out[k] = out[k]! + n;
  return out;
};
