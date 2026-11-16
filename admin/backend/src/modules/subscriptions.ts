// Admin -> Businesses -> Subscriptions (MARKETPLACE-AND-BILLING.md sections 5, 7 and 14.3; P3-BE-7): what a business has, and staff gifts.
// Where it fits: registered in admin/backend/src/app.ts under /v1. Entitlements v3 (platform/src/billing/entitlements.ts) reads the grants
// written here; the lifecycle job and the business marketplace never change them.
//   GET  /admin/subscriptions                                   ?status=&appId=&page=   every business's app subscriptions
//   GET  /admin/subscriptions/:tenantId                         one business: subscriptions (with the access in force now), grants, add-ons,
//                                                               history, app invoices and credit notes
//   POST /admin/subscriptions/:tenantId/grants                  { kind, appId?, key?, value?, endsAt, reason }   a gift or an extension
//   POST /admin/subscriptions/:tenantId/grants/:grantId/revoke  { reason }
//   POST /admin/subscriptions/:tenantId/:appId/extend-trial     { days, reason, version }
//   POST /admin/subscriptions/:tenantId/ai-credits              { credits, days, reason }   Sheetal AI credits as a gift (P3-BE-8)
// How it works: a gift is an EntitlementGrant (kind app = a whole app at an edition; limit = more of one limit; feature; seats) with an end
// date and a reason; it only ever raises what the business has and ends by itself. Taking one back sets revokedAt (the row stays).
// Extending a trial moves trialEndsAt (at most 90 days after the trial started), with the subscription's version (409 if stale).
// Rules: reading needs platform.business.read; changing needs platform.subscription.grant (super admin only at first). Everything is audited;
// a change to a subscription also writes its history (SubscriptionEvent).

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, notFound, versionConflict } from "@sheetal/platform/core/errors";
import { SettingsService } from "@sheetal/platform/settings/service";
import { BILLING_SETTING, CATALOG_SETTING, withNewApps } from "@sheetal/platform/billing/catalog";
import { effectiveStatus } from "@sheetal/platform/billing/effective-status";
import { taxNumber } from "@sheetal/platform/billing/invoice";
import { addGrant, creditBalance } from "@sheetal/platform/billing/ai-credits";
import type { SubscriptionStatus } from "@sheetal/platform/billing/types";
import { staffOf } from "./routes.js";

const QUIET = { warn: () => undefined };
const DAY = 864e5;
const Id = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);
const Reason = z.string().trim().min(5, "Give a reason of 5 to 300 characters.").max(300);
const Grant = z.object({
  kind: z.enum(["app", "limit", "feature", "seats"]), appId: Id.optional(), key: z.string().regex(/^[a-z][a-z0-9_.]{0,60}$/).optional(),
  value: z.number().int().min(0).max(1_000_000).optional(), endsAt: z.coerce.date(), reason: Reason,
}).strict();
const n = (v: bigint | null | undefined) => (v == null ? null : Number(v));

export async function adminSubscriptionRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const store = () => new SettingsService(db(), QUIET);

  app.get("/admin/subscriptions", async (request) => {
    staffOf(request, "platform.business.read");
    const q = z.object({ status: z.enum(["active", "trialing", "past_due", "read_only", "cancelled", "expired"]).optional(), appId: Id.optional(), page: z.coerce.number().int().min(1).default(1) }).parse(request.query);
    const where: Prisma.SubscriptionWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.appId ? { appId: q.appId } : {}), uninstalledAt: null };
    const per = 50;
    const [total, rows] = await Promise.all([db().subscription.count({ where }), db().subscription.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (q.page - 1) * per, take: per })]);
    const T = new Map((await db().tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true, type: true } })).map((t) => [t.id, t]));
    return {
      data: rows.map((s) => ({ id: s.id, tenantId: s.tenantId, business: T.get(s.tenantId) ?? null, appId: s.appId, editionId: s.editionId, status: s.status, periodMonths: s.periodMonths, priceGrossPaisa: Number(s.priceGrossPaisa), currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, source: s.source })),
      meta: { total, current_page: q.page, last_page: Math.max(1, Math.ceil(total / per)), per_page: per },
    };
  });

  app.get<{ Params: { tenantId: string } }>("/admin/subscriptions/:tenantId", async (request) => {
    staffOf(request, "platform.business.read");
    const t = await db().tenant.findUnique({ where: { id: request.params.tenantId }, select: { id: true, name: true, type: true, status: true, billingMode: true } });
    if (!t) throw notFound("Business not found.");
    const now = new Date();
    const [subs, grants, addons, events, invoices, catalog, billing] = await Promise.all([
      db().subscription.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "asc" } }),
      db().entitlementGrant.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      db().addonSubscription.findMany({ where: { tenantId: t.id } }),
      db().subscriptionEvent.findMany({ where: { tenantId: t.id }, orderBy: { at: "desc" }, take: 100 }),
      db().invoice.findMany({ where: { tenantId: t.id, kind: { in: ["subscription", "credit"] } }, orderBy: { createdAt: "desc" }, take: 50, include: { lines: { orderBy: { sort: "asc" } } } }),
      store().get(CATALOG_SETTING).then(withNewApps), store().get(BILLING_SETTING),
    ]);
    return {
      data: {
        business: t,
        subscriptions: subs.map((s) => ({
          id: s.id, appId: s.appId, editionId: s.editionId, status: s.status, periodMonths: s.periodMonths, priceGrossPaisa: Number(s.priceGrossPaisa), listPriceGrossPaisa: Number(s.listPriceGrossPaisa),
          currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, trialUsedAt: s.trialUsedAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd,
          pendingEditionId: s.pendingEditionId, source: s.source, installedAt: s.installedAt, uninstalledAt: s.uninstalledAt, version: s.version,
          now: effectiveStatus({ appId: s.appId, editionId: s.editionId, status: s.status as SubscriptionStatus, periodMonths: s.periodMonths, priceGrossPaisa: Number(s.priceGrossPaisa), currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, trialUsedAt: s.trialUsedAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, uninstalledAt: s.uninstalledAt },
            now, { freeEditionEnabled: catalog.apps[s.appId]?.freeEditionEnabled ?? false, settings: billing }),
        })),
        grants: grants.map((g) => ({ ...g, live: !g.revokedAt && g.startsAt <= now && (!g.endsAt || now < g.endsAt) })),
        addons: addons.map((a) => ({ ...a, unitPriceGrossPaisa: Number(a.unitPriceGrossPaisa) })),
        events: events.map((e) => ({ ...e, amountPaisa: n(e.amountPaisa) })),
        invoices: invoices.map((i) => ({
          id: i.id, kind: i.kind, status: i.status, number: i.no && i.fy ? taxNumber(i.fy, i.no, i.kind) : null, creditForId: i.creditForId, createdAt: i.createdAt, paidAt: i.paidAt,
          subtotalPaisa: n(i.subtotalPaisa), vatPaisa: n(i.vatPaisa), totalPaisa: n(i.totalPaisa),
          lines: i.lines.map((l) => ({ id: l.id, kind: l.kind, appId: l.appId, editionId: l.editionId, description: l.description, qty: l.qty, grossPaisa: Number(l.grossPaisa), vatPaisa: Number(l.vatPaisa), netPaisa: Number(l.netPaisa) })),
        })),
      },
    };
  });

  app.post<{ Params: { tenantId: string } }>("/admin/subscriptions/:tenantId/grants", async (request) => {
    const s = staffOf(request, "platform.subscription.grant");
    const b = Grant.parse(request.body);
    const t = await db().tenant.findUnique({ where: { id: request.params.tenantId }, select: { id: true, name: true } });
    if (!t) throw notFound("Business not found.");
    const now = new Date();
    if (b.endsAt <= now) throw badRequest("The end date must be in the future.");
    if (b.endsAt.getTime() > now.getTime() + 3 * 366 * DAY) throw badRequest("A gift lasts at most 3 years.");
    const catalog = withNewApps(await store().get(CATALOG_SETTING));
    let key = b.key ?? null; let value = b.value ?? null; const appId = b.appId ?? null;
    if (b.kind === "app") {
      const a = appId ? catalog.apps[appId] : undefined;
      if (!a) throw badRequest("Choose an app from the catalog.");
      key = key ?? (a.editions.full ? "full" : Object.keys(a.editions).find((e) => !a.editions[e]!.free) ?? null);
      if (!key || !a.editions[key]) throw badRequest("Choose an edition of this app.");
      value = null;
    } else if (b.kind === "limit") {
      const a = appId ? catalog.apps[appId] : undefined;
      if (!a || !key || !Object.values(a.editions).some((e) => key! in e.limits)) throw badRequest("Choose an app and one of its limits.");
      if (value == null) throw badRequest("Say how much the limit becomes.");
    } else if (b.kind === "feature") {
      if (!key) throw badRequest("Name the feature.");
      value = null;
    } else {
      if (value == null || value < 1) throw badRequest("Say how many seats.");
      key = null;
    }
    const g = await db().$transaction(async (tx) => {
      const g = await tx.entitlementGrant.create({ data: { tenantId: t.id, kind: b.kind, appId: b.kind === "feature" || b.kind === "seats" ? null : appId, key, value, source: "staff", reason: b.reason, endsAt: b.endsAt, createdBy: s.user.id } });
      const sub = appId ? await tx.subscription.findUnique({ where: { tenantId_appId: { tenantId: t.id, appId } } }) : null;
      if (sub) await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, tenantId: t.id, appId: sub.appId, type: "granted", actorKind: "staff", actorId: s.user.id, reason: b.reason, at: now } });
      await tx.auditLog.create({ data: { actorId: s.user.id, tenantId: t.id, action: "billing.grant_given", target: `${b.kind} ${[appId, key, value].filter((x) => x != null).join(" ")} until ${b.endsAt.toISOString().slice(0, 10)}`, ip: request.ip, meta: { grantId: g.id, reason: b.reason } } });
      return g;
    });
    return { message: `Given to ${t.name} until ${b.endsAt.toISOString().slice(0, 10)}.`, data: { id: g.id } };
  });

  app.post<{ Params: { tenantId: string; grantId: string } }>("/admin/subscriptions/:tenantId/grants/:grantId/revoke", async (request) => {
    const s = staffOf(request, "platform.subscription.grant");
    const { reason } = z.object({ reason: Reason }).strict().parse(request.body);
    const now = new Date();
    const g = await db().entitlementGrant.findFirst({ where: { id: request.params.grantId, tenantId: request.params.tenantId } });
    if (!g) throw notFound("Gift not found.");
    if (g.source !== "staff") throw badRequest("Only gifts made by staff can be taken back here (moved-plan access ends with its lock).");
    const u = await db().entitlementGrant.updateMany({ where: { id: g.id, revokedAt: null }, data: { revokedAt: now } });
    if (u.count !== 1) throw badRequest("This gift was already taken back.");
    await db().auditLog.create({ data: { actorId: s.user.id, tenantId: g.tenantId, action: "billing.grant_revoked", target: `${g.kind} ${[g.appId, g.key].filter(Boolean).join(" ")}`, ip: request.ip, meta: { grantId: g.id, reason } } });
    return { message: "Taken back." };
  });

  app.post<{ Params: { tenantId: string } }>("/admin/subscriptions/:tenantId/ai-credits", async (request) => {
    const s = staffOf(request, "platform.subscription.grant");
    const b = z.object({ credits: z.number().int().min(1).max(100_000), days: z.number().int().min(1).max(366), reason: Reason }).strict().parse(request.body);
    const t = await db().tenant.findUnique({ where: { id: request.params.tenantId }, select: { id: true, name: true } });
    if (!t) throw notFound("Business not found.");
    const expiresAt = new Date(Date.now() + b.days * DAY);
    const g = await addGrant(db(), { tenantId: t.id, credits: b.credits, source: "gift", expiresAt });
    await db().auditLog.create({ data: { actorId: s.user.id, tenantId: t.id, action: "billing.ai_credits_given", target: `${b.credits} AI credits until ${expiresAt.toISOString().slice(0, 10)}`, ip: request.ip, meta: { grantId: g.id, reason: b.reason } } });
    return { message: `${b.credits} AI credits given to ${t.name}.`, data: { id: g.id, balance: await creditBalance(db(), t.id) } };
  });

  app.post<{ Params: { tenantId: string; appId: string } }>("/admin/subscriptions/:tenantId/:appId/extend-trial", async (request) => {
    const s = staffOf(request, "platform.subscription.grant");
    const b = z.object({ days: z.number().int().min(1).max(30), reason: Reason, version: z.number().int().min(1) }).strict().parse(request.body);
    const sub = await db().subscription.findUnique({ where: { tenantId_appId: { tenantId: request.params.tenantId, appId: request.params.appId } } });
    if (!sub) throw notFound("Subscription not found.");
    const now = new Date();
    if (sub.status !== "trialing" || !sub.trialEndsAt) throw badRequest("Only a running trial can be extended.");
    const end = new Date(Math.max(sub.trialEndsAt.getTime(), now.getTime()) + b.days * DAY);
    const started = sub.trialUsedAt ?? sub.createdAt;
    if (end.getTime() > started.getTime() + 90 * DAY) throw badRequest("A trial lasts at most 90 days in all.");
    await db().$transaction(async (tx) => {
      const u = await tx.subscription.updateMany({ where: { id: sub.id, version: b.version, status: "trialing" }, data: { trialEndsAt: end, version: { increment: 1 } } });
      if (u.count !== 1) throw versionConflict("This subscription");
      await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, tenantId: sub.tenantId, appId: sub.appId, type: "trial_extended", fromStatus: "trialing", toStatus: "trialing", actorKind: "staff", actorId: s.user.id, reason: b.reason, at: now } });
      await tx.auditLog.create({ data: { actorId: s.user.id, tenantId: sub.tenantId, action: "billing.trial_extended", target: `${sub.appId} until ${end.toISOString().slice(0, 10)}`, ip: request.ip, meta: { days: b.days, reason: b.reason } } });
    });
    return { message: `The trial now ends on ${end.toISOString().slice(0, 10)}.`, data: { trialEndsAt: end } };
  });
}
