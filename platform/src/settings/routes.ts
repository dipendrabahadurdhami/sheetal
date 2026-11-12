// The admin routes of the typed settings store, the field builder, the theme and the revenue report (SETTINGS.md sections 2, 3, 5, 6, 7).
// Where it fits: admin/backend/src/app.ts registers settingsAdminRoutes(app, { settings, staffOf }) under /v1 (a route file does nothing until app.ts
// registers it).
//   GET    /admin/settings/store                 the settings a staff member may read, grouped, each with its value and whether it is the default
//   GET    /admin/settings/store/:key            one value, with its last changes
//   PUT    /admin/settings/store/:key            { value, reason? }   (the definition's own permission decides)
//   DELETE /admin/settings/store/:key            back to the default
//   GET    /admin/settings/forms                 the field builder's forms
//   PUT    /admin/settings/forms/:id             { fields, label } : saves a changed form (version + 1); the field builder's rules apply
//   GET    /admin/reports/revenue                ?range=today|7d|30d|custom&from=&to=   (&format=csv downloads it; the export is audited)
// Rules: no logic here: the service and the definitions decide. A setting the staff member may not read is left out of lists and answers 404 by key.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { StaffContext } from "../core/context.js";
import { badRequest, notFound } from "../core/errors.js";
import type { Db } from "../db/client.js";
import { FORM_SETTINGS, REVENUE_SHARE, describe, formSetting, settingOf } from "./defs.js";
import { FormDef, bumped } from "./field-defs.js";
import { revenueCsv, revenueReport } from "./revenue.js";
import { PLATFORM_OWNER, type SettingsService } from "./service.js";
import type { SettingDef } from "./types.js";

export interface SettingsRoutesOptions { db: Db; settings: SettingsService; staffOf: (req: FastifyRequest) => StaffContext }

const PutBody = z.object({ value: z.unknown(), reason: z.string().max(400).optional() }).strict();
const FormBody = z.object({ label: FormDef.shape.label, fields: FormDef.shape.fields }).strict();
const ReportQuery = z.object({ range: z.enum(["today", "7d", "30d", "custom"]).default("7d"), from: z.string().max(10).optional(), to: z.string().max(10).optional(), format: z.enum(["json", "csv"]).default("json") }).strict();

export async function settingsAdminRoutes(app: FastifyInstance, o: SettingsRoutesOptions) {
  const { settings } = o;
  const keyOf = (req: FastifyRequest): string => String((req.params as { key?: string }).key ?? "");
  const platformDef = (req: FastifyRequest, staff: StaffContext): SettingDef => {
    const def = settingOf(keyOf(req));
    if (!def || def.scope !== "platform" || !staff.permissions.can(def.read)) throw notFound("That setting does not exist.");
    return def;
  };
  const who = (req: FastifyRequest, staff: StaffContext, reason?: string) => ({ actorId: staff.staff.id, ip: req.ip, reason });

  app.get("/admin/settings/store", async (req) => {
    const staff = o.staffOf(req);
    const groups = [];
    for (const g of describe("platform")) {
      const list = [];
      for (const s of g.settings) {
        if (!staff.permissions.can(s.read)) continue;
        const v = await settings.view(settingOf(s.key)!, PLATFORM_OWNER);
        list.push({ ...s, value: v.value, isDefault: !v.stored, canChange: staff.permissions.can(s.write) });
      }
      if (list.length) groups.push({ group: g.group, settings: list });
    }
    return { data: groups };
  });

  app.get("/admin/settings/store/:key", async (req) => {
    const staff = o.staffOf(req);
    const def = platformDef(req, staff);
    const v = await settings.view(def, PLATFORM_OWNER);
    return { data: { key: def.key, label: def.label.en, value: v.value, isDefault: !v.stored, default: def.default, needsReason: !!def.needsReason, canChange: staff.permissions.can(def.write), history: await settings.history(def, PLATFORM_OWNER, 10) } };
  });

  app.put("/admin/settings/store/:key", { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (req) => {
    const staff = o.staffOf(req);
    const def = platformDef(req, staff);
    staff.permissions.require(def.write, "Your staff role can't change this setting.");
    if (def.key.startsWith("platform.fieldDefs.")) throw badRequest("Change a form on the Field builder screen.");
    const b = PutBody.parse(req.body);
    const value = await settings.set(def, b.value, who(req, staff, b.reason), PLATFORM_OWNER);
    return { message: "Saved.", data: { key: def.key, value, isDefault: false } };
  });

  app.delete("/admin/settings/store/:key", async (req) => {
    const staff = o.staffOf(req);
    const def = platformDef(req, staff);
    staff.permissions.require(def.write, "Your staff role can't change this setting.");
    if (def.needsReason) throw badRequest("This setting cannot be reset. Save the values you want, with a reason.");
    await settings.reset(def, who(req, staff), PLATFORM_OWNER);
    return { message: "Back to the default.", data: { key: def.key, value: def.default, isDefault: true } };
  });

  // ── Field builder ──
  app.get("/admin/settings/forms", async (req) => {
    const staff = o.staffOf(req);
    staff.permissions.require("platform.settings.read", "Your staff role can't see settings.");
    const forms = [];
    for (const def of FORM_SETTINGS) { const v = await settings.view(def, PLATFORM_OWNER); forms.push({ ...v.value, edited: v.stored }); }
    return { data: forms, meta: { canChange: staff.permissions.can("platform.settings.update") } };
  });

  app.put("/admin/settings/forms/:key", { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (req) => {
    const staff = o.staffOf(req);
    staff.permissions.require("platform.settings.update", "Your staff role can't change forms.");
    const def = formSetting(keyOf(req));
    if (!def) throw notFound("That form does not exist.");
    const b = FormBody.parse(req.body);
    const prev = await settings.get(def, PLATFORM_OWNER);
    const next = bumped(prev, { ...prev, label: b.label, fields: b.fields });
    const saved = await settings.set(def, next, who(req, staff), PLATFORM_OWNER);
    return { message: "Form saved.", data: { ...saved, edited: true } };
  });

  // ── Revenue report ──
  app.get("/admin/reports/revenue", async (req, reply) => {
    const staff = o.staffOf(req);
    staff.permissions.require("platform.revenue.read", "Your staff role can't see revenue.");
    const q = ReportQuery.parse(req.query ?? {});
    const report = await revenueReport(o.db, q, await settings.get(REVENUE_SHARE, PLATFORM_OWNER));
    if (q.format === "csv") {
      await o.db.auditLog.create({ data: { tenantId: null, actorId: staff.staff.id, action: "platform.revenue.export", target: `${report.from} to ${report.to}`, ip: req.ip } });
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="sheetal-revenue-${report.from}-to-${report.to}.csv"`).send(revenueCsv(report));
    }
    return { data: report };
  });
}
