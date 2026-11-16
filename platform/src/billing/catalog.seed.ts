// The first prices of the marketplace (MARKETPLACE-AND-BILLING.md section 3.4, the owner's answer to Q5: VAT included, yearly = 10 months).
// Where it fits: catalog.ts builds the first platform.catalog value from the app manifests (names, limits, features) plus this file (prices,
// limit behaviour, apps that have no code yet). After the first save in Admin -> Pricing the stored value is used and this file only fills
// in apps a new release adds.
// How it works: plain data in paisa. A price here is never read once the catalog is saved; changing it later changes nothing for anyone.
// Rules: no logic. Every paid edition of every manifest has a price here (a test checks it). Values marked "Owner to confirm" are the
// design's proposals, shown in the CHANGES note.

import type { AddonDef, AiCatalog, AppCatalog, LimitBehaviour } from "./types.js";

const month = (rupees: number) => ({ priceMonthPaisa: rupees * 100, priceYearPaisa: rupees * 100 * 10 });

/** Monthly price in rupees of each app's paid editions (VAT included). */
export const SEED_PRICES: Readonly<Record<string, Record<string, { priceMonthPaisa: number; priceYearPaisa: number }>>> = {
  crm: { full: month(300) },
  listings: { full: month(500) },
  rentals: { full: month(400) },
  collections: { full: month(300) },
  projects: { full: month(600) },
  investments: { full: month(400) },
  hotel: { full: month(700) },
  pos: { full: month(400) },
  invoicing: { full: month(300) },
  expenses: { full: month(200) },
  reviews: { full: month(150) },
  people: { full: month(300) },
  agreements: { full: month(200) },
};

/** Money-in activity is soft (+20%), everything else hard (Q1). */
export const SOFT_LIMITS: Readonly<Record<string, LimitBehaviour>> = { bills_per_month: "soft", invoices_per_month: "soft" };

const lim = (value: number | null, behaviour: LimitBehaviour = "hard") => ({ value, behaviour });
const free = (limits: AppCatalog["editions"][string]["limits"]) => ({ name: { en: "Free" }, free: true, priceMonthPaisa: 0, priceYearPaisa: 0, limits, features: [], sort: 0 });

/** Apps sold in the marketplace that have no manifest yet (their code moves into apps/ later).
 *  An app that is not built yet (coming_soon) starts hidden: nothing unfinished is shown to customers at launch (the owner's rule, 16 Nov).
 *  Admin -> Pricing -> "Shown in the marketplace" shows it when it is ready. */
export const SEED_EXTRA_APPS: Readonly<Record<string, AppCatalog>> = {
  // Business email: today's paid-plan mailboxes (1 GB). No free edition (MB 3.4: "none (locked)").
  mail: { name: { en: "Mail" }, availability: "live", visible: true, freeEditionEnabled: false, trialDays: 14, editions: {
    full: { name: { en: "Full" }, free: false, ...month(200), limits: { storage_mb: lim(1024) }, features: ["mail.own_domain"], sort: 1 },
  } },
  // Featured slots on the website (boosts and banners stay pay-per-use). Price: Owner to confirm (not in MB 3.4).
  promote: { name: { en: "Promote" }, availability: "live", visible: true, freeEditionEnabled: true, trialDays: 14, editions: {
    free: free({ featured_slots: lim(0) }),
    full: { name: { en: "Full" }, free: false, ...month(300), limits: { featured_slots: lim(8) }, features: [], sort: 1 },
  } },
  payroll: { name: { en: "Payroll" }, availability: "coming_soon", visible: false, freeEditionEnabled: false, trialDays: null, editions: {
    full: { name: { en: "Full" }, free: false, ...month(400), limits: {}, features: [], sort: 1 },
  } },
  accounting: { name: { en: "Accounting" }, availability: "coming_soon", visible: false, freeEditionEnabled: true, trialDays: 14, editions: {
    free: free({ ledgers: lim(1), entries_per_month: lim(50) }),
    full: { name: { en: "Full" }, free: false, ...month(500), limits: { ledgers: lim(null), entries_per_month: lim(null) }, features: [], sort: 1 },
  } },
  restaurant: { name: { en: "Restaurant" }, availability: "coming_soon", visible: false, freeEditionEnabled: true, trialDays: 14, editions: {
    free: free({ outlets: lim(1) }),
    full: { name: { en: "Full" }, free: false, ...month(400), limits: { outlets: lim(null) }, features: [], sort: 1 },
  } },
};

export const SEED_BUSINESS = {
  freeSeats: 2,
  seatAddon: month(200),
  storageAddon: { unitMb: 1024, ...month(100) },
  paidFeatures: ["custom_roles", "multi_property", "branding.custom", "api.access"],
};

/** Limit packs (for example +25 listings). */
export const SEED_ADDONS: readonly AddonDef[] = [
  { key: "listings_pack", appId: "listings", name: { en: "+25 listings" }, limitKey: "listings", step: 25, ...month(300), needsPaidEdition: true, active: true },
];

export const SEED_AI: AiCatalog = {
  plans: [
    { key: "lite", name: { en: "AI Lite" }, ...month(300), creditsPerMonth: 1_000, features: ["text", "vision"], sort: 1 },
    { key: "plus", name: { en: "AI Plus" }, ...month(800), creditsPerMonth: 4_000, features: ["text", "vision", "voice"], sort: 2 },
    { key: "max", name: { en: "AI Max" }, ...month(1_800), creditsPerMonth: 12_000, features: ["text", "vision", "voice", "priority"], sort: 3 },
  ],
  topup: { priceGrossPaisa: 20_000, credits: 1_000, validDays: 90 },
  trialCredits: 100,
  trialDays: 14,
  creditRates: { text: 1, vision: 2, voicePerMinute: 5 },
};
