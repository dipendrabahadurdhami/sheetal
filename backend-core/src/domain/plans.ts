import { BUSINESS_TYPES, type BusinessType } from "./permissions.js";

// Starter (free) / Business / Pro for every business type. Mirrors shared/src/demo/demo.js PLANS and
// shared/src/core/plans.js; test/domain.test.ts fails if they differ. Admin can change prices later (stored in the plans table).

const OFF = { pos: false, channel_sync: false, agreements: false, api: false, custom_roles: false, multi_property: false, all_kinds: false };
const PRO_FEATURES = { pos: true, channel_sync: true, agreements: true, api: true, custom_roles: true, multi_property: true, all_kinds: true };
const PRO_LIMITS = { listings: -1, stays: 10, rooms: -1, units: -1, outlets: 10, projects: 10, investments: 5, seats: 25, featured: 20 };
const TYPE_PLANS: Record<BusinessType, { starter: Record<string, number>; business: Record<string, number>; features: Partial<typeof OFF> }> = {
  hotel: { starter: { rooms: 10, outlets: 0 }, business: { rooms: 40, outlets: 3 }, features: { pos: true, channel_sync: true, agreements: true, custom_roles: true, multi_property: true } },
  host: { starter: { units: 1 }, business: { units: 10 }, features: { pos: true, channel_sync: true, agreements: true, custom_roles: true, multi_property: true } },
  developer: { starter: { projects: 1, units: 50 }, business: { projects: 2, units: 300 }, features: { agreements: true, custom_roles: true, multi_property: true } },
  agency: { starter: { listings: 1 }, business: { listings: 150 }, features: { agreements: true, custom_roles: true, multi_property: true } },
  sponsor: { starter: { investments: 1 }, business: { investments: 3 }, features: { agreements: true, custom_roles: true } },
};

export interface PlanDef { id: string; type: BusinessType; name: "Starter" | "Business" | "Pro"; price: number; limits: Record<string, number>; features: Record<string, boolean>; sort: number }

export const PLANS: PlanDef[] = BUSINESS_TYPES.flatMap((type) => {
  const x = TYPE_PLANS[type];
  return [
    { id: `${type}-starter`, type, name: "Starter" as const, price: 0, limits: { ...x.starter, seats: 1, featured: 0 }, features: { ...OFF }, sort: 1 },
    { id: `${type}-business`, type, name: "Business" as const, price: 1500, limits: { ...x.business, seats: 10, featured: 8 }, features: { ...OFF, ...x.features }, sort: 2 },
    { id: `${type}-pro`, type, name: "Pro" as const, price: 3000, limits: { ...PRO_LIMITS }, features: { ...PRO_FEATURES }, sort: 3 },
  ];
});

// Pay for 1, 3, 6 or 12 months; longer periods save more.
export const PERIODS = [{ months: 1, save: 0 }, { months: 3, save: 9 }, { months: 6, save: 19 }, { months: 12, save: 39 }] as const;
export const priceFor = (monthly: number, months = 1) => {
  const p = PERIODS.find((x) => x.months === months) ?? PERIODS[0];
  return Math.round(monthly * p.months * (1 - p.save / 100));
};

export const starterPlanId = (type: BusinessType) => `${type}-starter`;

/** Email storage per business: paid plans (Business, Pro) get 1 GB shared by all mailboxes; Starter has no team email. */
export const MAIL_QUOTA_BYTES = 1024 ** 3;
export const mailQuotaBytes = (plan: { price: number }) => (plan.price > 0 ? MAIL_QUOTA_BYTES : 0);
