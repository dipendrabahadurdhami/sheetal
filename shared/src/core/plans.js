// Plan rules used by every app. What a business can do depends on its type and its plan:
// Starter (free) — one listing, the basics. Business — the tools of its own type. Pro — every kind and module.
import { BUSINESS_TYPES } from "./rbac";

export const PLAN_FEATURES = ["all_kinds", "pos", "channel_sync", "agreements", "custom_roles", "multi_property", "api"];
export const LIMIT_KEYS = { hotel: ["rooms", "outlets", "seats", "featured"], host: ["units", "seats", "featured"], developer: ["projects", "units", "seats", "featured"], agency: ["listings", "seats", "featured"], sponsor: ["investments", "seats", "featured"] };
export const ALL_LIMIT_KEYS = ["listings", "stays", "rooms", "units", "outlets", "projects", "investments", "seats", "featured"];

// Billing periods: pay for 1, 3, 6 or 12 months; longer periods save more.
export const PERIODS = [{ months: 1, save: 0 }, { months: 3, save: 9 }, { months: 6, save: 19 }, { months: 12, save: 39 }];
export const priceFor = (plan, months = 1) => { const p = PERIODS.find((x) => x.months === months) || PERIODS[0]; return Math.round((plan?.price || 0) * p.months * (1 - p.save / 100)); };
export const savingFor = (plan, months = 1) => (plan?.price || 0) * months - priceFor(plan, months);

export const planOf = (db, tenant) => (db.plans || []).find((p) => p.id === tenant?.planId);
export const isFree = (plan) => !plan || !plan.price;
export const isAllAccess = (plan) => !!plan?.features?.all_kinds;
export const limitKeysFor = (type, plan) => (isAllAccess(plan) ? ALL_LIMIT_KEYS : LIMIT_KEYS[type] || []);
// Business types whose modules this workspace sees.
export const typesFor = (tenant, plan) => (isAllAccess(plan) ? Object.keys(BUSINESS_TYPES) : [tenant.type]);
// Listing kinds this workspace may create.
export const kindsFor = (catalog, tenant, plan) => (isAllAccess(plan) ? catalog.listingKinds.map((k) => k.id) : catalog.kindsByType?.[tenant.type] || ["sell"]);
// How many listings may exist at once: Starter 1, otherwise the plan's listing limit (-1 = no limit).
export const listingCap = (plan) => (isFree(plan) ? 1 : plan.limits?.listings ?? -1);
export const atListingCap = (plan, count) => { const cap = listingCap(plan); return cap !== -1 && count >= cap; };
