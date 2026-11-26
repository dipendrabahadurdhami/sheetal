// Phase 3 billing: the shapes every billing file shares (MARKETPLACE-AND-BILLING.md, "MB", sections 3, 5 and 16).
// Where it fits: the pure core (days, effective-status, limits, proration, anchor, coupon, lock, quote) and, later, the catalog setting
// (P3-BE-1), entitlements v3 (P3-BE-3), invoices (P3-BE-4) and the routes all speak these types.
// How it works: plain data only. Money is a whole number of paisa (a JS number, always a safe integer); prices are VAT included.
// Rules: no database, no clock, no imports beyond types. A field added here is optional or has a default in BILLING_DEFAULTS, so a
// saved catalog or settings value from an older release still reads.

/** Words shown to people: English always, Nepali when written (the screens fall back to English). */
export type Text = { en: string; ne?: string };

export type LimitBehaviour = "hard" | "soft";
export interface CatalogLimit {
  /** null = unlimited. */
  value: number | null;
  behaviour: LimitBehaviour;
  /** Soft limits only: how far over is still allowed, in percent (default 20). */
  softOverPct?: number;
}

export interface EditionCatalog {
  name: Text;
  free: boolean;
  /** VAT included. 0 for a free edition. */
  priceMonthPaisa: number;
  priceYearPaisa: number;
  limits: Record<string, CatalogLimit>;
  features: string[];
  sort: number;
}

export interface AppCatalog {
  /** The app's name for invoices and cards (seeded from the manifest). */
  name?: Text;
  availability: "live" | "coming_soon";
  /** false = hidden from the marketplace; existing subscriptions keep working. */
  visible: boolean;
  /** false = a paid-only app (no free edition to fall back to). */
  freeEditionEnabled: boolean;
  /** null = no trial. */
  trialDays: number | null;
  editions: Record<string, EditionCatalog>;
}

export interface AddonDef {
  key: string;
  /** null = a business-level add-on (seats, storage). */
  appId: string | null;
  name: Text;
  limitKey: string;
  step: number;
  priceMonthPaisa: number;
  priceYearPaisa: number;
  needsPaidEdition: boolean;
  active: boolean;
}

/** Sheetal AI (MB section 10.2): business-level plans and top-ups, priced like apps. */
export interface AiPlanCatalog { key: string; name: Text; priceMonthPaisa: number; priceYearPaisa: number; creditsPerMonth: number; features: string[]; sort: number }
export interface AiCatalog {
  plans: AiPlanCatalog[];
  topup: { priceGrossPaisa: number; credits: number; validDays: number };
  /** New free businesses: one-time credits during a trial (the owner's answer to Q4). */
  trialCredits: number;
  trialDays: number;
  /** Credits per feature use, by capability. */
  creditRates: { text: number; vision: number; voicePerMinute: number };
}

export interface Catalog {
  version: number;
  /** Months offered for new purchases. */
  periods: number[];
  business: {
    freeSeats: number;
    seatAddon: { priceMonthPaisa: number; priceYearPaisa: number };
    storageAddon: { unitMb: number; priceMonthPaisa: number; priceYearPaisa: number };
    /** Features that any paid edition in full access switches on for the whole business. */
    paidFeatures: string[];
  };
  apps: Record<string, AppCatalog>;
  addons: AddonDef[];
  ai?: AiCatalog;
  /** Software packs (packs.ts): Starter, Business, Pro. Optional so a catalog saved before packs still fits; withNewApps() fills them in. */
  packs?: Record<string, import("./packs.js").Pack>;
}

/** The platform.billing setting (MB section 16). Every day count and amount is editable in Admin; these are the defaults. */
export interface BillingSettings {
  vatRatePct: number;
  pricesIncludeVat: boolean;
  graceDays: number;
  readOnlyDays: number;
  /** Days before the period end when a reminder goes out (and after, as negative numbers are not used: past-due reminders are separate). */
  reminderDays: number[];
  pastDueReminderDays: number[];
  refundWindowDays: number;
  minChargePaisa: number;
  priceChangeNoticeDays: number;
  quoteHours: number;
  trialDays: number;
  seatAutoPauseDays: number;
  migrationLockMonths: number;
  migrationFreeLimitDays: number;
  /** A new app joining a monthly business with fewer days than this left runs to the following anchor (MB section 5.3). */
  minFirstPeriodDays: number;
  salesEnabled: boolean;
  requireTaxInfo: boolean;
}

export const BILLING_DEFAULTS: Readonly<BillingSettings> = Object.freeze({
  vatRatePct: 13,
  pricesIncludeVat: true,
  graceDays: 7,
  readOnlyDays: 60,
  reminderDays: [7, 1],
  pastDueReminderDays: [3, 6],
  refundWindowDays: 7,
  minChargePaisa: 1_000,
  priceChangeNoticeDays: 30,
  quoteHours: 24,
  trialDays: 14,
  seatAutoPauseDays: 14,
  migrationLockMonths: 12,
  migrationFreeLimitDays: 90,
  minFirstPeriodDays: 5,
  salesEnabled: false,
  requireTaxInfo: true,
});

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "read_only" | "cancelled" | "expired";
export type AccessMode = "full" | "limited" | "read_only" | "locked" | "none";

/** What the pure core needs of a Subscription row (dates as Date, money as paisa numbers). */
export interface SubscriptionState {
  appId: string;
  editionId: string;
  status: SubscriptionStatus;
  /** null for a free edition. */
  periodMonths: number | null;
  priceGrossPaisa: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  trialUsedAt: Date | null;
  cancelAtPeriodEnd: boolean;
  uninstalledAt: Date | null;
}

/** Price protection of a migrated business (the BillingLock row, MB section 8.3). */
export interface LockState {
  legacyMonthlyGrossPaisa: number;
  legacyPeriodMonths: number;
  coversApps: string[];
  lockEnd: Date;
}

/** Everything the quote needs to know about one business. */
export interface BillingState {
  /** Day of month (1 to 28) the monthly apps renew on; null before the first paid monthly purchase. */
  anchorDay: number | null;
  subscriptions: SubscriptionState[];
  lock: LockState | null;
  /** Coupon redemptions so far, for the per-business limit. */
  couponUsesByBusiness?: number;
  /** All redemptions of the coupon, for maxRedemptions. */
  couponUsesTotal?: number;
}

export type CartItem =
  | { kind: "subscribe"; appId: string; editionId: string; periodMonths: number }
  | { kind: "change"; appId: string; editionId: string; periodMonths: number }
  | { kind: "renew"; appId: string }
  | { kind: "addon"; addonKey: string; qty: number };

export interface CouponInput {
  code: string;
  kind: "percent" | "fixed_paisa" | "trial_days";
  value: number;
  appliesTo: "all" | "apps" | "editions";
  appIds: string[];
  /** "appId:editionId" pairs, or plain edition ids. */
  editionIds: string[];
  firstPurchaseOnly: boolean;
  minSpendPaisa: number | null;
  validFrom: Date | null;
  validTo: Date | null;
  maxRedemptions: number | null;
  perBusinessLimit: number;
  active: boolean;
}

export type QuoteLineKind = "subscription" | "addon" | "proration_credit" | "price_protection" | "carry";
export interface QuoteLine {
  kind: QuoteLineKind;
  appId: string | null;
  editionId: string | null;
  addonKey?: string;
  description: Text;
  periodStart: Date | null;
  periodEnd: Date | null;
  periodMonths: number | null;
  qty: number;
  unitGrossPaisa: number;
  discountPaisa: number;
  /** After the discount. Negative for credits and price protection. */
  grossPaisa: number;
  netPaisa: number;
  vatPaisa: number;
  saleType: "new" | "renewal" | "upgrade" | "addon";
}

export interface Quote {
  lines: QuoteLine[];
  discountPaisa: number;
  subtotalPaisa: number;
  vatPaisa: number;
  totalPaisa: number;
  /** A small proration below the minimum charge, moved to the next invoice. */
  carryPaisa: number;
  /** The anchor day after this purchase (the first monthly purchase sets it). */
  anchorDay: number | null;
  dueAt: Date;
  notes: Text[];
  warnings: Text[];
  errors: Text[];
}
