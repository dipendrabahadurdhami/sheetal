// Platform settings: the values that belong to the whole platform, not to one business.
// Where it fits: read by billing (VAT, grace days, auto-suspend), workspace creation (trial days), the website's public
// /site endpoint, and the admin panel (Admin → Settings). Integration keys (Google, WhatsApp, Cloudflare) live here too.
// How it works: AppSetting row "platform" holds only what staff changed; platformSettings() fills the rest with the
// defaults below, which are the values the platform used before this screen existed. Integration rows are
// "integration.google", "integration.whatsapp" and "integration.cloudflare"; their secrets are sealed with the Vault.
// Rules: change a default here only on purpose. Secrets are write-only: read them with openSecret(), never send them to a browser.

import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import type { Vault } from "@sheetal/platform/auth/vault";

export interface PlatformSettings {
  siteName: string;
  supportEmail: string;
  supportPhone: string;
  domains: { site: string; business: string; admin: string };
  /** VAT in percent, included in plan prices. */
  vatRate: number;
  /** Default commission in percent Sheetal keeps from online payments. */
  commissionPct: number;
  /** Language codes switched on (en, ne). */
  languages: string[];
  /** Days a new business may try a paid plan; 0 = no trial. */
  trialDays: number;
  /** Days after a plan ends before the business moves to Starter. */
  graceDays: number;
  /** When off, a business past its grace period stays "past due" until staff act. */
  autoSuspend: boolean;
  maxLoginAttempts: number;
  /** Days a sign-in lasts without being used (each use renews it): 7 = a week without opening the site or app signs you out. */
  sessionDays: number;
  /** After the password, a 6-digit code by email (SMS later) before the sign-in is made. */
  loginCode: boolean;
  maintenance: { on: boolean; message: string };
}

export const PLATFORM_DEFAULTS: PlatformSettings = {
  siteName: "Sheetal Property",
  supportEmail: "support@sheetalproperty.com",
  supportPhone: "",
  domains: { site: "sheetalproperty.com", business: "business.sheetalproperty.com", admin: "sheetalproperty.com/admin" },
  vatRate: 13,
  commissionPct: 10,
  languages: ["en", "ne"],
  trialDays: 0,
  graceDays: 7,
  autoSuspend: true,
  maxLoginAttempts: 5,
  sessionDays: 7,
  loginCode: true,
  maintenance: { on: false, message: "We're making some improvements. Please check back soon." },
};

/** Fields only a super admin may change. */
export const SUPER_ONLY = ["maxLoginAttempts", "sessionDays", "loginCode", "maintenance"] as const;

type Stored = Partial<Omit<PlatformSettings, "domains" | "maintenance">> & { domains?: Partial<PlatformSettings["domains"]>; maintenance?: Partial<PlatformSettings["maintenance"]> };

const rowOf = async (db: Db): Promise<Stored> => ((await db.appSetting.findUnique({ where: { key: "platform" } }))?.value ?? {}) as Stored;

/** What staff saved, merged over the defaults. */
export async function platformSettings(db: Db): Promise<PlatformSettings> {
  const s = await rowOf(db);
  return { ...PLATFORM_DEFAULTS, ...s, domains: { ...PLATFORM_DEFAULTS.domains, ...(s.domains ?? {}) }, maintenance: { ...PLATFORM_DEFAULTS.maintenance, ...(s.maintenance ?? {}) } };
}

/** Only the fields staff have saved (used where an older setting, such as the billing row, is the fallback). */
export const platformSaved = rowOf;

/** Saves a change on top of what is stored. */
export async function savePlatform(db: Db, patch: Stored) {
  const cur = await rowOf(db);
  const next = { ...cur, ...patch, domains: { ...(cur.domains ?? {}), ...(patch.domains ?? {}) }, maintenance: { ...(cur.maintenance ?? {}), ...(patch.maintenance ?? {}) } } as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: "platform" }, create: { key: "platform", value: next }, update: { value: next } });
}

// ───── Integrations ─────

export const INTEGRATION_IDS = ["google", "whatsapp", "cloudflare"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export interface GoogleSettings { measurementId?: string; searchConsoleToken?: string; mapsKey?: string; signInClientId?: string; signInClientSecret?: string; signIn?: string }
export interface WhatsappSettings { mode?: "cloud" | "qr"; phoneId?: string; token?: string; qrStatus?: "not_paired" | "waiting" | "paired" }
export interface CloudflareSettings { zoneId?: string; apiToken?: string }
export interface IntegrationShape { google: GoogleSettings; whatsapp: WhatsappSettings; cloudflare: CloudflareSettings }

/** Which fields of each integration are secrets (sealed, write-only). */
export const SECRET_FIELDS: { [K in IntegrationId]: string[] } = { google: ["mapsKey", "signInClientSecret"], whatsapp: ["token"], cloudflare: ["apiToken"] };

export async function integrationSettings<K extends IntegrationId>(db: Db, id: K): Promise<IntegrationShape[K]> {
  return ((await db.appSetting.findUnique({ where: { key: `integration.${id}` } }))?.value ?? {}) as IntegrationShape[K];
}

export async function saveIntegration(db: Db, id: IntegrationId, value: object) {
  await db.appSetting.upsert({ where: { key: `integration.${id}` }, create: { key: `integration.${id}`, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
}

/** Opens a sealed secret, or undefined when none is saved. */
export const openSecret = (vault: Vault, sealed?: string) => (sealed ? vault.open(sealed) : undefined);

/** The values the public website may see: nothing secret. */
export async function publicSite(db: Db) {
  const [p, g] = await Promise.all([platformSettings(db), integrationSettings(db, "google")]);
  return {
    siteName: p.siteName, languages: p.languages,
    googleAnalyticsId: g.measurementId || null, searchConsoleToken: g.searchConsoleToken || null,
    maintenance: p.maintenance.on ? { on: true, message: p.maintenance.message } : { on: false, message: "" },
  };
}
