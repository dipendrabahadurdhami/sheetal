// The marketplace catalog and the billing settings as typed settings (MARKETPLACE-AND-BILLING.md sections 3 and 16).
// Where it fits: platform.catalog (apps, editions, prices, limits, trials, add-ons, Sheetal AI plans) and platform.billing (VAT, grace and
// read-only days, minimum charge, …) live in the typed settings store (platform/src/settings), edited in Admin -> Pricing (P3-FE-3) with a
// reason and an audit row. The quote, entitlements v3 and the routes read them. GET /public/catalog shows the public part (publicCatalog).
// How it works: the first value (the setting's default) is built once from the app manifests (names, limits, features, trial days) and the
// seed file (prices, limit behaviour, apps without code yet). A saved value always wins; withNewApps() only ADDS apps and editions a new
// release brings, it never changes a saved number. catalogProblems() is the guard: it refuses a value that would break billing.
// Rules: money is paisa (whole numbers). The public view has prices, limits and names only: no version notes, no internal fields, nothing
// about the company or partners.

import { z } from "zod";
import { APPS } from "../tenancy/apps.generated.js";
import type { AppManifest } from "../core/manifest.js";
import type { SettingDef } from "../settings/types.js";
import { SEED_ADDONS, SEED_AI, SEED_BUSINESS, SEED_EXTRA_APPS, SEED_PRICES, SOFT_LIMITS } from "./catalog.seed.js";
import { BILLING_DEFAULTS, type AppCatalog, type BillingSettings, type Catalog, type EditionCatalog } from "./types.js";

// ───────────── Schemas (the one place a catalog is validated) ─────────────

const Text = z.object({ en: z.string().trim().min(1).max(200), ne: z.string().trim().max(200).optional() });
const Paisa = z.number().int().min(0).max(100_000_000_000);
const Limit = z.object({ value: z.number().int().min(0).nullable(), behaviour: z.enum(["hard", "soft"]), softOverPct: z.number().int().min(0).max(100).optional() });
const Edition = z.object({
  name: Text, free: z.boolean(), priceMonthPaisa: Paisa, priceYearPaisa: Paisa,
  limits: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), Limit), features: z.array(z.string().max(60)).max(60), sort: z.number().int().min(0).max(1000),
});
const App = z.object({
  name: Text.optional(), availability: z.enum(["live", "coming_soon"]), visible: z.boolean(), freeEditionEnabled: z.boolean(),
  trialDays: z.number().int().min(1).max(90).nullable(), editions: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,20}$/), Edition),
});
const Addon = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), appId: z.string().nullable(), name: Text, limitKey: z.string().max(40), step: z.number().int().min(1).max(100_000),
  priceMonthPaisa: Paisa, priceYearPaisa: Paisa, needsPaidEdition: z.boolean(), active: z.boolean(),
});
const Ai = z.object({
  plans: z.array(z.object({ key: z.string().max(30), name: Text, priceMonthPaisa: Paisa, priceYearPaisa: Paisa, creditsPerMonth: z.number().int().min(0), features: z.array(z.string().max(30)), sort: z.number().int() })).max(10),
  topup: z.object({ priceGrossPaisa: Paisa, credits: z.number().int().min(1), validDays: z.number().int().min(1).max(730) }),
  trialCredits: z.number().int().min(0).max(100_000), trialDays: z.number().int().min(0).max(90),
  creditRates: z.object({ text: z.number().int().min(0), vision: z.number().int().min(0), voicePerMinute: z.number().int().min(0) }),
});
export const CatalogSchema = z.object({
  version: z.number().int().min(1),
  periods: z.array(z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)])).min(1),
  business: z.object({
    freeSeats: z.number().int().min(1).max(1000),
    seatAddon: z.object({ priceMonthPaisa: Paisa, priceYearPaisa: Paisa }),
    storageAddon: z.object({ unitMb: z.number().int().min(1), priceMonthPaisa: Paisa, priceYearPaisa: Paisa }),
    paidFeatures: z.array(z.string().max(60)).max(60),
  }),
  apps: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), App),
  addons: z.array(Addon).max(200),
  ai: Ai.optional(),
}) as unknown as z.ZodType<Catalog>;

export const BillingSettingsSchema = z.object({
  vatRatePct: z.number().min(0).max(50), pricesIncludeVat: z.boolean(), graceDays: z.number().int().min(0).max(60), readOnlyDays: z.number().int().min(0).max(365),
  reminderDays: z.array(z.number().int().min(0).max(60)).max(10), pastDueReminderDays: z.array(z.number().int().min(1).max(60)).max(10),
  refundWindowDays: z.number().int().min(0).max(90), minChargePaisa: Paisa, priceChangeNoticeDays: z.number().int().min(0).max(180),
  quoteHours: z.number().int().min(1).max(720), trialDays: z.number().int().min(0).max(90), seatAutoPauseDays: z.number().int().min(0).max(180),
  migrationLockMonths: z.number().int().min(0).max(36), migrationFreeLimitDays: z.number().int().min(0).max(365), minFirstPeriodDays: z.number().int().min(0).max(28),
  salesEnabled: z.boolean(), requireTaxInfo: z.boolean(),
}) as unknown as z.ZodType<BillingSettings>;

// ───────────── The first value ─────────────

/** One manifest's catalog entry: names, limits (with behaviour), features and trial from the manifest; prices from the seed. */
export function appFromManifest(m: Pick<AppManifest, "id" | "name" | "editions" | "trialDays" | "availability">): AppCatalog {
  const editions: Record<string, EditionCatalog> = {};
  m.editions.forEach((e, i) => {
    const fromManifest = e.price ? { priceMonthPaisa: e.price.monthPaisa, priceYearPaisa: e.price.yearPaisa } : null;
    const price = e.free ? { priceMonthPaisa: 0, priceYearPaisa: 0 } : (SEED_PRICES[m.id]?.[e.id] ?? fromManifest ?? { priceMonthPaisa: 0, priceYearPaisa: 0 });
    editions[e.id] = {
      name: { ...e.name }, free: e.free, ...price, sort: i,
      limits: Object.fromEntries(Object.entries(e.limits).map(([k, v]) => [k, { value: v, behaviour: SOFT_LIMITS[k] ?? "hard" }])),
      features: [...e.features],
    };
  });
  return { name: { ...m.name }, availability: m.availability ?? "live", visible: true, freeEditionEnabled: m.editions.some((e) => e.free), trialDays: m.trialDays, editions };
}

/** The catalog before anyone saved one: every sellable manifest plus the seed's extra apps. */
export function seedCatalog(manifests: readonly AppManifest[] = APPS): Catalog {
  const apps: Record<string, AppCatalog> = {};
  for (const m of manifests) if (m.kind === "app") apps[m.id] = appFromManifest(m);
  for (const [id, a] of Object.entries(SEED_EXTRA_APPS)) if (!apps[id]) apps[id] = structuredClone(a);
  return {
    version: 1, periods: [1, 12], business: structuredClone(SEED_BUSINESS), apps,
    addons: SEED_ADDONS.map((a) => ({ ...a, name: { ...a.name } })), ai: structuredClone(SEED_AI),
  };
}

/** A saved catalog with what a new release added (new apps, new editions, new limit keys) filled in from the seed. Never changes a saved value. */
export function withNewApps(saved: Catalog, seed: Catalog = seedCatalog()): Catalog {
  const out = structuredClone(saved);
  for (const [id, app] of Object.entries(seed.apps)) {
    const have = out.apps[id];
    if (!have) { out.apps[id] = structuredClone(app); continue; }
    for (const [ed, e] of Object.entries(app.editions)) {
      const mine = have.editions[ed];
      if (!mine) { have.editions[ed] = structuredClone(e); continue; }
      for (const [k, l] of Object.entries(e.limits)) if (!(k in mine.limits)) mine.limits[k] = { ...l };
    }
  }
  if (!out.ai && seed.ai) out.ai = structuredClone(seed.ai);
  return out;
}

/** The app id a Sheetal AI plan is sold and renewed under (aiAllowance() reads a subscription of this app, editionId = plan key). */
export const SHEETAL_AI_APP = "sheetal_ai";

/**
 * The catalog with the Sheetal AI plans as one hidden app (P3-FE-6): each plan becomes a paid edition, so the cart's quote(), the invoice and the
 * lifecycle job sell and renew a plan exactly like an app. Hidden (visible: false) so it never shows as a marketplace card; the AI page sells it.
 * Without AI plans in the catalog it returns the catalog unchanged.
 */
export function withAiApp(cat: Catalog): Catalog {
  if (!cat.ai?.plans?.length || cat.apps[SHEETAL_AI_APP]) return cat;
  const out = structuredClone(cat);
  out.apps[SHEETAL_AI_APP] = {
    name: { en: "Sheetal AI" }, availability: "live", visible: false, freeEditionEnabled: false, trialDays: null,
    editions: Object.fromEntries(cat.ai.plans.map((p) => [p.key, {
      name: p.name, free: false, priceMonthPaisa: p.priceMonthPaisa, priceYearPaisa: p.priceYearPaisa, limits: {}, features: [...p.features], sort: p.sort,
    }])),
  };
  return out;
}

// ───────────── Guards (MB 3.3) ─────────────

/** Problems that make a catalog unsafe to save, as plain sentences (the first is shown). prev = the value it replaces. */
export function catalogProblems(next: Catalog, prev?: Catalog, manifests: readonly AppManifest[] = APPS): string[] {
  const out: string[] = [];
  if (prev && next.version < prev.version) out.push("The catalog version can't go back.");
  for (const [id, app] of Object.entries(next.apps)) {
    const eds = Object.entries(app.editions);
    if (!eds.length) out.push(`${id}: an app needs at least one edition.`);
    if (app.freeEditionEnabled && !eds.some(([, e]) => e.free)) out.push(`${id}: the free edition is switched on but the app has none.`);
    for (const [ed, e] of eds) {
      const where = `${id} ${ed}`;
      if (e.free && (e.priceMonthPaisa !== 0 || e.priceYearPaisa !== 0)) out.push(`${where}: a free edition's price is 0.`);
      if (!e.free && e.priceMonthPaisa <= 0 && app.availability === "live") out.push(`${where}: a paid edition needs a monthly price.`);
      if (!e.free && e.priceYearPaisa > e.priceMonthPaisa * 12) out.push(`${where}: the yearly price can't be more than 12 monthly prices.`);
    }
    // Every limit the app's code counts must have a value in every edition (null = unlimited is fine; a missing key is not).
    const m = manifests.find((x) => x.id === id);
    if (m) for (const decl of m.limits) for (const [ed, e] of eds) if (!(decl.key in e.limits)) out.push(`${id} ${ed}: the limit "${decl.key}" is missing.`);
    if (prev?.apps[id]) for (const ed of Object.keys(prev.apps[id]!.editions)) if (!app.editions[ed]) out.push(`${id}: the edition "${ed}" can't be removed (hide the app from new sales instead).`);
  }
  if (prev) for (const id of Object.keys(prev.apps)) if (!next.apps[id]) out.push(`${id}: an app can't be removed from the catalog (hide it instead).`);
  for (const a of next.addons) {
    if (a.appId && !next.apps[a.appId]) out.push(`Add-on ${a.key}: the app "${a.appId}" isn't in the catalog.`);
    if (a.priceYearPaisa > a.priceMonthPaisa * 12) out.push(`Add-on ${a.key}: the yearly price can't be more than 12 monthly prices.`);
  }
  if (new Set(next.addons.map((a) => a.key)).size !== next.addons.length) out.push("Two add-ons have the same key.");
  return out;
}

export function billingSettingsProblems(next: BillingSettings): string[] {
  const out: string[] = [];
  if (!next.pricesIncludeVat) out.push("Prices include VAT (the owner's decision, Q5): this can't be switched off here.");
  if (next.minChargePaisa > 100_000) out.push("The minimum charge can't be more than Rs 1,000.");
  return out;
}

// ───────────── The settings ─────────────

export const CATALOG_SETTING: SettingDef<Catalog> = {
  key: "platform.catalog", scope: "platform", schema: CatalogSchema, default: seedCatalog(), group: "pricing",
  label: { en: "Apps, editions and prices" }, help: { en: "Every app's editions, prices (VAT included), free limits, trial days and add-ons. A price change applies to new sales at once and to renewals after the notice period." },
  read: "platform.billing.read", write: "platform.pricing.manage", needsReason: true, audit: "values",
  guard: (next, prev) => catalogProblems(next, prev)[0] ?? null,
};

export const BILLING_SETTING: SettingDef<BillingSettings> = {
  key: "platform.billing", scope: "platform", schema: BillingSettingsSchema, default: { ...BILLING_DEFAULTS, reminderDays: [...BILLING_DEFAULTS.reminderDays], pastDueReminderDays: [...BILLING_DEFAULTS.pastDueReminderDays] }, group: "pricing",
  label: { en: "Billing rules" }, help: { en: "VAT, grace and read-only days, reminders, refund window, minimum charge and whether sales are switched on." },
  read: "platform.billing.read", write: "platform.pricing.manage", needsReason: true, audit: "values",
  guard: (next) => billingSettingsProblems(next)[0] ?? null,
};

// ───────────── The public view ─────────────

export interface PublicApp {
  id: string; name: { en: string; ne?: string }; tagline: { en: string; ne?: string } | null; icon: string | null; category: string | null;
  availability: "live" | "coming_soon"; trialDays: number | null; freeEdition: boolean;
  editions: { id: string; name: { en: string; ne?: string }; free: boolean; priceMonthPaisa: number; priceYearPaisa: number; limits: Record<string, number | null>; features: string[] }[];
}

/** What anyone may see: visible apps with their editions, prices, limits and features; seats and add-on prices; Sheetal AI plans. */
export function publicCatalog(cat: Catalog, manifests: readonly AppManifest[] = APPS) {
  const apps: PublicApp[] = Object.entries(cat.apps).filter(([, a]) => a.visible).map(([id, a]) => {
    const m = manifests.find((x) => x.id === id);
    return {
      id, name: a.name ?? m?.name ?? { en: id }, tagline: m?.tagline ?? null, icon: m?.icon ?? null, category: m?.category ?? null,
      availability: a.availability, trialDays: a.trialDays, freeEdition: a.freeEditionEnabled,
      editions: Object.entries(a.editions).sort(([, x], [, y]) => x.sort - y.sort).map(([eid, e]) => ({
        id: eid, name: e.name, free: e.free, priceMonthPaisa: e.priceMonthPaisa, priceYearPaisa: e.priceYearPaisa,
        limits: Object.fromEntries(Object.entries(e.limits).map(([k, l]) => [k, l.value])), features: [...e.features],
      })),
    };
  });
  return {
    periods: [...cat.periods], vatIncluded: true,
    business: { freeSeats: cat.business.freeSeats, seatAddon: { ...cat.business.seatAddon }, storageAddon: { ...cat.business.storageAddon } },
    apps,
    addons: cat.addons.filter((a) => a.active).map((a) => ({ key: a.key, appId: a.appId, name: a.name, step: a.step, priceMonthPaisa: a.priceMonthPaisa, priceYearPaisa: a.priceYearPaisa })),
    ai: cat.ai ? { plans: cat.ai.plans.map((p) => ({ key: p.key, name: p.name, priceMonthPaisa: p.priceMonthPaisa, priceYearPaisa: p.priceYearPaisa, creditsPerMonth: p.creditsPerMonth })), topup: { ...cat.ai.topup } } : null,
  };
}
