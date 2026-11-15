// Admin -> Coupons (MARKETPLACE-AND-BILLING.md sections 5.3, 14.3 and 15; P3-BE-7): make a code, pause or end it, see who used it.
// Where it fits: registered in admin/backend/src/app.ts under /v1. The quote and the business checkout read the same Coupon rows
// (platform/src/billing/coupon.ts); a use is a CouponRedemption written when the invoice is paid.
//   GET   /admin/coupons                    every code with its uses and the money it took off
//   POST  /admin/coupons                    a new code
//   PATCH /admin/coupons/:id                { version, active?, validTo?, maxRedemptions? }   pause, resume, end early, cap
//   GET   /admin/coupons/:id/redemptions    who used it, on which invoice, for how much
// How it works: codes are stored in capitals (the database checks it). What a code gives (kind, value, apps) never changes once made, so an
// invoice that used it always matches its coupon; to give something else, make a new code. Changes carry the row's version (409 if stale).
// Rules: platform.billing.read to see, platform.pricing.manage to change; every change is audited.

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, conflict, notFound, versionConflict } from "@sheetal/platform/core/errors";
import { SettingsService } from "@sheetal/platform/settings/service";
import { CATALOG_SETTING, withNewApps } from "@sheetal/platform/billing/catalog";
import { taxNumber } from "@sheetal/platform/billing/invoice";
import { staffOf } from "./routes.js";

const QUIET = { warn: () => undefined };
const Id = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const Create = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, "Use 3 to 32 letters, numbers, - or _."),
  kind: z.enum(["percent", "fixed_paisa", "trial_days"]),
  value: z.number().int().min(1).max(100_000_000),
  appliesTo: z.enum(["all", "apps", "editions"]).default("all"),
  appIds: z.array(Id).max(50).default([]),
  editionIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,40}(:[a-z][a-z0-9_]{0,20})?$/)).max(100).default([]),
  firstPurchaseOnly: z.boolean().default(false),
  minSpendPaisa: z.number().int().min(0).max(100_000_000).nullable().default(null),
  validFrom: z.coerce.date().nullable().default(null),
  validTo: z.coerce.date().nullable().default(null),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
  perBusinessLimit: z.number().int().min(1).max(100).default(1),
  periods: z.number().int().min(1).max(12).default(1),
}).strict();
const Patch = z.object({
  version: z.number().int().min(1), active: z.boolean().optional(), validTo: z.coerce.date().nullable().optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
}).strict();

const n = (v: bigint | null | undefined) => (v == null ? null : Number(v));

export async function adminCouponRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const audit = (actorId: string, ip: string, action: string, target: string, meta?: object) =>
    db().auditLog.create({ data: { actorId, action, target, ip, meta: meta as object | undefined } });

  app.get("/admin/coupons", async (request) => {
    staffOf(request, "platform.billing.read");
    const [rows, uses] = await Promise.all([
      db().coupon.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
      db().couponRedemption.groupBy({ by: ["couponId"], _count: true, _sum: { discountPaisa: true } }),
    ]);
    const u = new Map(uses.map((x) => [x.couponId, x]));
    return { data: rows.map((c) => ({ ...c, minSpendPaisa: n(c.minSpendPaisa), uses: u.get(c.id)?._count ?? 0, discountPaisa: n(u.get(c.id)?._sum.discountPaisa) ?? 0 })) };
  });

  app.post("/admin/coupons", async (request) => {
    const s = staffOf(request, "platform.pricing.manage");
    const b = Create.parse(request.body);
    if (b.kind === "percent" && b.value > 100) throw badRequest("A percent is at most 100.");
    if (b.kind === "trial_days" && b.value > 90) throw badRequest("A trial is at most 90 days.");
    if (b.validFrom && b.validTo && b.validTo <= b.validFrom) throw badRequest("The end must be after the start.");
    if (b.appliesTo === "apps" && !b.appIds.length) throw badRequest("Choose at least one app.");
    if (b.appliesTo === "editions" && !b.editionIds.length) throw badRequest("Choose at least one edition.");
    const cat = withNewApps(await new SettingsService(db(), QUIET).get(CATALOG_SETTING));
    const named = [...b.appIds, ...b.editionIds.filter((e) => e.includes(":")).map((e) => e.split(":")[0]!)];
    const unknown = named.find((a) => !cat.apps[a]);
    if (unknown) throw badRequest(`"${unknown}" isn't an app in the catalog.`);
    try {
      const c = await db().coupon.create({ data: {
        ...b, appIds: b.appliesTo === "apps" ? b.appIds : [], editionIds: b.appliesTo === "editions" ? b.editionIds : [],
        minSpendPaisa: b.minSpendPaisa == null ? null : BigInt(b.minSpendPaisa), createdBy: s.user.id,
      } });
      await audit(s.user.id, request.ip, "billing.coupon_created", c.code, { kind: c.kind, value: c.value, appliesTo: c.appliesTo });
      return { message: `${c.code} is ready.`, data: { id: c.id } };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict(`The code ${b.code} already exists.`);
      throw e;
    }
  });

  app.patch<{ Params: { id: string } }>("/admin/coupons/:id", async (request) => {
    const s = staffOf(request, "platform.pricing.manage");
    const b = Patch.parse(request.body);
    const c = await db().coupon.findUnique({ where: { id: request.params.id } });
    if (!c) throw notFound("Coupon not found.");
    const data = { ...(b.active !== undefined ? { active: b.active } : {}), ...(b.validTo !== undefined ? { validTo: b.validTo } : {}), ...(b.maxRedemptions !== undefined ? { maxRedemptions: b.maxRedemptions } : {}) };
    if (!Object.keys(data).length) throw badRequest("Nothing to change.");
    const u = await db().coupon.updateMany({ where: { id: c.id, version: b.version }, data: { ...data, version: { increment: 1 } } });
    if (u.count !== 1) throw versionConflict("This coupon");
    await audit(s.user.id, request.ip, b.active === false ? "billing.coupon_paused" : "billing.coupon_updated", c.code, data);
    return { message: b.active === false ? `${c.code} is paused.` : `${c.code} updated.` };
  });

  app.get<{ Params: { id: string } }>("/admin/coupons/:id/redemptions", async (request) => {
    staffOf(request, "platform.billing.read");
    const c = await db().coupon.findUnique({ where: { id: request.params.id } });
    if (!c) throw notFound("Coupon not found.");
    const rows = await db().couponRedemption.findMany({ where: { couponId: c.id }, orderBy: { at: "desc" }, take: 500 });
    const [tenants, invoices] = await Promise.all([
      db().tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true } }),
      db().invoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId) } }, select: { id: true, no: true, fy: true, kind: true } }),
    ]);
    const T = new Map(tenants.map((t) => [t.id, t.name])), I = new Map(invoices.map((i) => [i.id, i]));
    return { data: rows.map((r) => {
      const i = I.get(r.invoiceId);
      return { id: r.id, at: r.at, tenantId: r.tenantId, business: T.get(r.tenantId) ?? null, invoiceId: r.invoiceId, number: i?.no && i.fy ? taxNumber(i.fy, i.no, i.kind) : null, discountPaisa: Number(r.discountPaisa) };
    }) };
  });
}
