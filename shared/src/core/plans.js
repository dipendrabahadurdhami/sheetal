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

// ───────────── What each plan includes, as shown on the plan cards ─────────────
// One list per business type, in the same order for Starter, Business and Pro, so the three cards line up row by row.
// Each row is [included, text]. It follows the limits and switches above and what /business unlocks for each plan
// (Starter: the basics and its type's core tools within its limits; Business: all tools of its type; Pro: everything).
export const AI_CREDITS = { Starter: 500, Business: 2000, Pro: 6000 }; // per month; Admin → AI can change them

const n = (v) => Number(v).toLocaleString("en-IN");
const limitText = (v, one, many) => (v === -1 ? `Unlimited ${many}` : `${n(v)} ${v === 1 ? one : many}`);

// The listings or places a plan holds, and the core tools of the business type.
const TYPE_ROWS = {
  agency: (p) => [
    [true, limitText(listingCap(p), "listing at a time", "listings at a time")],
    [true, "Rentals: tenants, rent and repairs"],
    [true, "Collections: tokens and instalments"],
  ],
  hotel: (p) => [
    [true, limitText(p.limits?.rooms ?? 0, "room", "rooms")],
    [true, "Bookings and room calendar"],
    [!!p.features?.pos, p.features?.pos ? `Point of sale and stock, ${limitText(p.limits?.outlets ?? 0, "outlet", "outlets")}` : "Point of sale and stock"],
    [!!p.features?.channel_sync, "Sync with Booking.com, Airbnb and Agoda"],
  ],
  host: (p) => [
    [true, limitText(p.limits?.units ?? 0, "home or room", "homes or rooms")],
    [true, "Bookings and calendar"],
    [!!p.features?.pos, "Point of sale and stock"],
    [!!p.features?.channel_sync, "Sync with Booking.com, Airbnb and Agoda"],
  ],
  developer: (p) => [
    [true, `${limitText(p.limits?.projects ?? 0, "project", "projects")}, ${limitText(p.limits?.units ?? 0, "unit", "units")}`],
    [true, "Unit inventory, buyers and progress updates"],
    [true, "Collections: bookings and instalments"],
  ],
  sponsor: (p) => [
    [true, limitText(p.limits?.investments ?? 0, "open investment", "open investments")],
    [true, "Investor records and updates"],
  ],
};

/** Rows for one plan card: [included, text]. */
export function planFeatureList(plan, type = plan?.type, credits = AI_CREDITS) {
  const free = isFree(plan), all = isAllAccess(plan), f = plan?.features || {};
  const seats = plan?.limits?.seats ?? 1, featured = plan?.limits?.featured ?? 0;
  return [
    [true, "Your business page on Sheetal"],
    ...(TYPE_ROWS[type] || TYPE_ROWS.agency)(plan || {}),
    [true, "Inbox for calls, WhatsApp and website leads"],
    [true, "Online forms for enquiries and bookings"],
    [true, "Listing check-ups and reminders"],
    [true, "Customer reviews"],
    [true, "Online payments, invoices and payouts"],
    [true, "Share to Facebook, Instagram and WhatsApp"],
    [true, `AI help: ${n(credits[plan?.name] ?? 0)} credits a month`],
    [featured > 0, featured > 0 ? limitText(featured, "featured listing", "featured listings") : "Featured listings"],
    [seats > 1, seats > 1 ? `Team of ${n(seats)} with roles` : "Team members (just you on Starter)"],
    [!!f.custom_roles, "Your own roles and permissions"],
    [!!f.agreements, "Agreements with e-signatures"],
    [!free, "AI voice assistant in Nepali and English"],
    [!free, "Expenses and profit"],
    [!!f.multi_property, "Several branches or properties"],
    [all, "Every kind: stays, projects and investments too"],
    [!!f.api, "Website API, embeds and no Sheetal badge"],
  ];
}
