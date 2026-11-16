// The request bodies of the admin billing API (P3-BE-7), in one file so the admin screens' tests parse what the pages send with the very same
// rules (TEAM-RULES #12, P3-FE-3). Where it fits: pricing.ts, coupons.ts, subscriptions.ts and platform-approvals.ts parse with these;
// admin/frontend/src/pages/pricingLogic.test.js builds bodies with the page helpers and parses them here.
// Rules: plain zod only (no server imports); moved here unchanged.

import { z } from "zod";

export const Id = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
export const Reason = z.string().trim().min(5, "Give a reason of 5 to 300 characters.").max(300);

// Pricing
export const PricingPreview = z.object({ catalog: z.unknown() }).strict();
export const PricingSave = z.object({ catalog: z.unknown(), reason: Reason }).strict();

// Coupons
export const CouponCreate = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, "Use 3 to 32 letters, numbers, - or _."),
  kind: z.enum(["percent", "fixed_paisa", "trial_days"]),
  value: z.number().int().min(1).max(100_000_000),
  appliesTo: z.enum(["all", "apps", "editions"]).default("all"),
  appIds: z.array(Id).max(50).default([]),
  editionIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,40}(:[a-z][a-z0-9_]{0,20})?$/)).max(100).default([]),
  firstPurchaseOnly: z.boolean().default(false),
  minSpendPaisa: z.number().int().min(0).max(100_000_000).nullable().default(null),
  validFrom: z.coerce.date().nullable().default(null),
  validTo: z.coerce.date().nullable().default(null),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
  perBusinessLimit: z.number().int().min(1).max(100).default(1),
  periods: z.number().int().min(1).max(12).default(1),
}).strict();
export const CouponPatch = z.object({
  version: z.number().int().min(1), active: z.boolean().optional(), validTo: z.coerce.date().nullable().optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
}).strict();

// One business's subscriptions
export const Grant = z.object({
  kind: z.enum(["app", "limit", "feature", "seats"]), appId: Id.optional(), key: z.string().regex(/^[a-z][a-z0-9_.]{0,60}$/).optional(),
  value: z.number().int().min(0).max(1_000_000).optional(), endsAt: z.coerce.date(), reason: Reason,
}).strict();
export const Revoke = z.object({ reason: Reason }).strict();
export const AiCredits = z.object({ credits: z.number().int().min(1).max(100_000), days: z.number().int().min(1).max(366), reason: Reason }).strict();
export const ExtendTrial = z.object({ days: z.number().int().min(1).max(30), reason: Reason, version: z.number().int().min(1) }).strict();

// Maker-checker approvals
export const Decide = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().min(3, "Say why.").max(300) }).strict();
