// Every setting the typed store knows (SETTINGS.md section 2.3), and the list the admin screens are drawn from.
// Where it fits: service.ts reads and writes these; routes.ts lets staff open the ones their role may. A new setting = one entry here.
// How it works: the form definitions of the field builder are one setting per form ("platform.fieldDefs.<formId>") whose default is the seed, so a form
// exists before anyone saves it and a new release never overwrites a saved one.
// Phase 3 (P3-BE-1) adds platform.catalog and platform.billing (the marketplace; platform/src/billing/catalog.ts); P3-BE-11 platform.posting (posting.ts).
// Rules: today's rows "platform", "billing", "payments" and "catalog" are NOT here yet: their own screens and readers keep working unchanged, and they move
// into this store when their screens are redrawn from data (the close-out note lists it). Integration settings are connections, never settings.

import { z } from "zod";
import { FORM_SEEDS, FormDef, checkFormChange } from "./field-defs.js";
import { REVENUE_SHARE_DEFAULT, RevenueShare } from "./revenue-share.js";
import { THEME_DEFAULT, ThemeTokens, themeProblems } from "./theme-tokens.js";
import type { SettingDef } from "./types.js";
import { BILLING_SETTING, CATALOG_SETTING } from "../billing/catalog.js";
import { COMPANY_SETTING } from "../billing/company.js";
import { BUSINESS_AI } from "../ai/settings.js";
import { POSTING_SETTING } from "./posting.js";

export const REVENUE_SHARE: SettingDef<RevenueShare> = {
  key: "platform.revenueShare", scope: "platform", schema: RevenueShare, default: REVENUE_SHARE_DEFAULT, group: "revenue",
  label: { en: "Revenue share" }, help: { en: "Sheetal's commission on online payments and the technology partner's part of it." },
  read: "platform.revenue.read", write: "platform.revenue_share.manage", needsReason: true, audit: "values",
  guard: (next, prev) => (next.effectiveFrom < prev.effectiveFrom ? "The start date cannot move back before the current one: earlier days are never rewritten." : null),
};

export const PLATFORM_THEME: SettingDef<ThemeTokens> = {
  key: "platform.theme", scope: "platform", schema: ThemeTokens, default: THEME_DEFAULT, group: "theme", public: true,
  label: { en: "Sheetal's look" }, help: { en: "Colours, corner radius and logos for the website, the admin panel and every business without its own branding." },
  read: "platform.settings.read", write: "platform.settings.update", audit: "values",
  guard: (next) => themeProblems(next)[0] ?? null,
};

export const BUSINESS_THEME: SettingDef<ThemeTokens> = {
  key: "business.theme", scope: "business", schema: ThemeTokens, default: THEME_DEFAULT, group: "theme",
  label: { en: "The business's look" }, read: "workspace.settings.update", write: "workspace.settings.update", audit: "values",
  guard: (next) => themeProblems(next)[0] ?? null,
};

const Answers = z.object({ values: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), z.union([z.string().max(5000), z.number(), z.boolean(), z.array(z.string().max(200)).max(60), z.null()])), version: z.number().int().min(1) }).strict();
export const BUSINESS_PROFILE: SettingDef<z.infer<typeof Answers>> = {
  key: "business.profile", scope: "business", schema: Answers, default: { values: {}, version: 1 }, group: "profile",
  label: { en: "Business profile answers" }, read: "workspace.settings.update", write: "workspace.settings.update",
};

/** The business's own ways to be paid without a gateway (MB section 12, P3-BE-9): a free static QR picture (eSewa, Fonepay or bank QR) shown
 *  at its checkouts, and the words under it. Never used for Sheetal's own payments.
 *  Not in SETTING_DEFS yet: it joins the list (and the pinned business list in settings-pure.test.ts) with its screen (P3-FE-2). */
const BusinessPayments = z.object({
  staticQr: z.object({ fileId: z.string().max(100).nullable(), label: z.string().trim().max(120) }).strict(),
}).strict();
export const BUSINESS_PAYMENTS: SettingDef<z.infer<typeof BusinessPayments>> = {
  key: "business.payments", scope: "business", schema: BusinessPayments, default: { staticQr: { fileId: null, label: "" } }, group: "payments",
  label: { en: "Ways to be paid" }, help: { en: "A QR picture your customers can scan to pay you directly. Payments to you never pass through Sheetal." },
  read: "workspace.settings.update", write: "workspace.settings.update",
};

/** One setting per form of the field builder. The guard is the field builder's own rules (archive, never delete; keys and types never change). */
export const formDefSetting = (seed: FormDef): SettingDef<FormDef> => ({
  key: `platform.fieldDefs.${seed.id}`, scope: "platform", schema: FormDef, default: seed, group: "fields",
  label: { en: `Form: ${seed.label.en}` }, read: "platform.settings.read", write: "platform.settings.update",
  guard: (next, prev) => checkFormChange(prev, next),
});
export const FORM_SETTINGS: readonly SettingDef<FormDef>[] = FORM_SEEDS.map(formDefSetting);
export const formSetting = (formId: string): SettingDef<FormDef> | null => FORM_SETTINGS.find((d) => d.key === `platform.fieldDefs.${formId}`) ?? null;

export const SETTING_DEFS: readonly SettingDef<never>[] = [REVENUE_SHARE, PLATFORM_THEME, BUSINESS_THEME, BUSINESS_PROFILE, ...FORM_SETTINGS, CATALOG_SETTING, BILLING_SETTING, COMPANY_SETTING, BUSINESS_AI, POSTING_SETTING] as unknown as SettingDef<never>[];
export const settingOf = (key: string): SettingDef | null => (SETTING_DEFS as unknown as SettingDef[]).find((d) => d.key === key) ?? null;

/** The definitions of one scope, grouped for a screen (no values, no schema). */
export function describe(scope: "platform" | "business") {
  const groups = new Map<string, { key: string; label: string; help: string | null; read: string; write: string; needsReason: boolean; public: boolean }[]>();
  for (const d of SETTING_DEFS as unknown as SettingDef[]) {
    if (d.scope !== scope) continue;
    const list = groups.get(d.group) ?? [];
    list.push({ key: d.key, label: d.label.en, help: d.help?.en ?? null, read: d.read, write: d.write, needsReason: !!d.needsReason, public: !!d.public });
    groups.set(d.group, list);
  }
  return [...groups.entries()].map(([group, settings]) => ({ group, settings }));
}

/** Problems in the list itself (a test runs it): duplicate keys, a default that does not pass its own schema. */
export function settingProblems(): string[] {
  const out: string[] = []; const seen = new Set<string>();
  for (const d of SETTING_DEFS as unknown as SettingDef[]) {
    if (seen.has(d.key)) out.push(`${d.key}: declared twice`);
    seen.add(d.key);
    if (!d.schema.safeParse(d.default).success) out.push(`${d.key}: the default does not pass its own schema`);
    if (d.scope === "platform" && !d.read.startsWith("platform.")) out.push(`${d.key}: a platform setting needs a platform permission`);
  }
  return out;
}
