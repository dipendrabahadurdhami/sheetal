// Business → Settings → one tab per app: the settings each app's manifest declares with scope "business" (APP-MANIFEST.md `settings`), read and changed
// through the typed settings store (platform/src/settings/service.ts) under the business's own key (P2-W6 leftover "Settings tab per app").
// Where it fits: AppSettingsController (GET /workspace/app-settings, PUT /workspace/app-settings/:key); the screen is apps/workspace/frontend/pages/AppSettingsPage.jsx.
// How it works: each declaration becomes a SettingDef (type -> zod schema, the manifest's default); the store writes the value and its audit line in one
// transaction and keeps the history. Only apps the business has (ctx.entitlements.hasApp) are listed; Workspace (always on) included.
// Rules: changing needs workspace.settings.update and is refused in a read-only support session; the business id comes only from the context.

import { z, type ZodType } from "zod";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { AppError, forbidden, notFound } from "@sheetal/platform/core/errors";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import type { SettingDecl } from "@sheetal/platform/core/manifest";
import type { SettingDef } from "@sheetal/platform/settings/types";
import type { SettingsService } from "@sheetal/platform/settings/service";

export const SETTINGS_PERM = "workspace.settings.update";

/** The value a declaration of this type takes (null = "not set" where the default is null). */
export function schemaOf(d: SettingDecl): ZodType {
  const base: Record<SettingDecl["type"], ZodType> = {
    int: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    money: z.number().int("Whole rupees only.").min(0, "Enter 0 or more.").max(10_000_000_000),
    bool: z.boolean(),
    text: z.string().trim().max(500),
    select: z.string().trim().min(1).max(60),
    list: z.array(z.string().trim().min(1).max(80)).max(200),
    json: z.unknown(),
  };
  return d.default === null ? base[d.type].nullable() : base[d.type];
}

/** A manifest declaration as a typed-store setting of the business. */
export const defOf = (d: SettingDecl): SettingDef => ({
  key: d.key, scope: "business", schema: schemaOf(d), default: d.default ?? null, label: d.label, group: "apps",
  read: SETTINGS_PERM, write: SETTINGS_PERM, audit: "values",
} as unknown as SettingDef);

/** Every app's business-scope settings: [{ app, label, settings: decl[] }]. */
export const appSettingDecls = () => APPS
  .map((a) => ({ app: a.id, label: a.name, settings: a.settings.filter((s) => s.scope === "business") }))
  .filter((a) => a.settings.length);

export class AppSettingsService {
  constructor(private readonly store: () => SettingsService) {}

  /** The apps of this business that have settings, each with its settings' current values. */
  async list(ctx: BusinessContext) {
    const out = [];
    for (const a of appSettingDecls().filter((x) => x.app === "workspace" || ctx.entitlements.hasApp(x.app))) {
      const settings = [];
      for (const d of a.settings) {
        const v = await this.store().view(defOf(d), { tenantId: ctx.business.id });
        settings.push({ key: d.key, label: d.label, type: d.type, default: d.default ?? null, value: v.value, stored: v.stored });
      }
      out.push({ app: a.app, label: a.label, settings });
    }
    return { apps: out, canEdit: ctx.permissions.can(SETTINGS_PERM) };
  }

  /** Changes one setting of this business. */
  async change(ctx: BusinessContext, key: string, raw: unknown) {
    if (ctx.impersonation?.readOnly) throw forbidden("This is a read-only support session. Changes are not allowed.");
    if (!ctx.permissions.can(SETTINGS_PERM)) throw forbidden("Only people who manage the business's settings can do this.");
    const found = appSettingDecls().flatMap((a) => a.settings.map((d) => ({ app: a.app, d }))).find((x) => x.d.key === key);
    if (!found || (found.app !== "workspace" && !ctx.entitlements.hasApp(found.app))) throw notFound("That setting isn't one of this business's apps.");
    const body = z.object({ value: z.unknown() }).strict().safeParse(raw);
    if (!body.success) throw new AppError(422, "validation", "Send { value }.", { value: ["Send a value."] });
    const value = await this.store().set(defOf(found.d), body.data.value, { actorId: ctx.member.userId, ip: ctx.ip }, { tenantId: ctx.business.id });
    return { message: `${found.d.label.en} saved.`, data: { key, value } };
  }
}
