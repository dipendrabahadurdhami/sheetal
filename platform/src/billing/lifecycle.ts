// The subscription lifecycle job (MARKETPLACE-AND-BILLING.md sections 5.1, 5.5 and 8.3; P3-BE-5): every hour, for businesses on
// billingMode "apps", it announces what the dates already decided and prepares the next renewal.
// Where it fits: admin/backend runs it as the job "billing.subscriptions" next to today's "billing.renewal" (which now skips businesses on
// "apps"). Access never waits for this job: effectiveStatus() decides from the dates on every request (rule 7: dates decide, jobs announce).
// How it works, per subscription:
//   1. status: when effectiveStatus() differs from the stored word, store the new one, write ONE history row and tell the owner
//      (past due, read-only, ended, trial ended).
//   2. renewal: once a paid period is within the first reminder day count (default 7 days) of its end, ONE open renewal invoice per business
//      is made through quote() for every app due (same co-termed date), with price protection for a migrated business and a waiting
//      downgrade applied. Cancelled ones get none.
//   3. reminders: at each reminder day count before the end, one note to the owner per period.
//   4. Sheetal AI plan (appId "sheetal_ai"): the month's credits (aiAllowance in ai-credits.ts), nothing else.
// Rules: safe to run twice (each step checks it has not been done for this period); one business's failure never stops the others; nothing
// here charges anyone (Nepal wallets keep no cards); a business on "plans" or "shadow" is never touched.

import { AI_PLAN_APP, aiAllowance } from "./ai-credits.js";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client.js";
import { SettingsService } from "../settings/service.js";
import { BILLING_SETTING, CATALOG_SETTING, withNewApps } from "./catalog.js";
import { anchorOf, nepalDays } from "./days.js";
import { effectiveStatus } from "./effective-status.js";
import { createInvoiceFromQuote } from "./invoice.js";
import { quote } from "./quote.js";
import type { BillingSettings, Catalog, SubscriptionState, SubscriptionStatus } from "./types.js";

export interface LifecycleSummary { businesses: number; statusChanges: number; renewalInvoices: number; reminders: number; failures: number; aiAllowances: number }

const MESSAGES: Partial<Record<SubscriptionStatus, (app: string) => { title: string; message: string }>> = {
  past_due: (a) => ({ title: `${a}: payment due`, message: `Your ${a} period has ended. Pay the renewal within the grace days to keep everything as it is.` }),
  read_only: (a) => ({ title: `${a} is read-only`, message: `Your ${a} subscription has ended: you can still see, print and export everything. Renew to make changes.` }),
  expired: (a) => ({ title: `${a} subscription ended`, message: `Your ${a} subscription has ended. Your data is safe; renew any time to continue.` }),
};

const toState = (s: { appId: string; editionId: string; status: string; periodMonths: number | null; priceGrossPaisa: bigint; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; trialEndsAt: Date | null; trialUsedAt: Date | null; cancelAtPeriodEnd: boolean; uninstalledAt: Date | null }): SubscriptionState => ({
  appId: s.appId, editionId: s.editionId, status: s.status as SubscriptionStatus, periodMonths: s.periodMonths, priceGrossPaisa: Number(s.priceGrossPaisa),
  currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, trialUsedAt: s.trialUsedAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, uninstalledAt: s.uninstalledAt,
});

async function ownerId(db: Db, tenantId: string): Promise<string | null> {
  const m = await db.membership.findFirst({ where: { tenantId, status: "active", role: { key: "owner" } }, orderBy: { createdAt: "asc" }, select: { userId: true } });
  return m?.userId ?? null;
}

async function tell(db: Db, tenantId: string, n: { type: string; title: string; message: string }) {
  const userId = await ownerId(db, tenantId);
  if (userId) await db.notification.create({ data: { userId, tenantId, type: n.type, title: n.title.slice(0, 200), message: n.message.slice(0, 1000), link: "/business/billing" } });
}

export async function runSubscriptionLifecycle(db: Db, o: { log: FastifyBaseLogger; now?: Date; catalog?: Catalog; settings?: BillingSettings }): Promise<LifecycleSummary> {
  const now = o.now ?? new Date();
  const store = new SettingsService(db as never, o.log);
  const catalog = o.catalog ?? withNewApps(await store.get(CATALOG_SETTING));
  const settings = o.settings ?? (await store.get(BILLING_SETTING));
  const out: LifecycleSummary = { businesses: 0, statusChanges: 0, renewalInvoices: 0, reminders: 0, failures: 0, aiAllowances: 0 };
  const tenants = await db.tenant.findMany({ where: { billingMode: "apps" }, select: { id: true, name: true, billingLock: true } });
  const nameOf = (appId: string) => catalog.apps[appId]?.name?.en ?? appId;

  for (const t of tenants) {
    out.businesses++;
    try {
      const subs = await db.subscription.findMany({ where: { tenantId: t.id, uninstalledAt: null }, orderBy: { createdAt: "asc" } });
      const due: string[] = [];
      for (const s of subs) {
        // A Sheetal AI plan (MB 10.2, P3-BE-8) is business-level, not an app of the catalog: this job only adds its monthly credits
        // (once per month of a paid period). Its renewal comes with its purchase in the cart.
        if (s.appId === AI_PLAN_APP) {
          if (s.periodMonths && s.currentPeriodStart && s.currentPeriodEnd && s.status !== "expired" && now < s.currentPeriodEnd) {
            const r = await aiAllowance(db, { tenantId: t.id, planKey: s.editionId, periodStart: s.currentPeriodStart, periodEnd: s.currentPeriodEnd, catalog: catalog.ai, now });
            if (r.created) out.aiAllowances++;
          }
          continue;
        }
        const st = toState(s);
        const app = catalog.apps[s.appId];
        const es = effectiveStatus(st, now, { freeEditionEnabled: app?.freeEditionEnabled ?? false, settings });

        // 1. Announce a status the dates already decided (once).
        if (es.status !== s.status && !(s.status === "cancelled" && es.status === "cancelled")) {
          const changed = await db.subscription.updateMany({ where: { id: s.id, status: s.status }, data: {
            status: es.status, ...(es.status === "past_due" ? { graceUntil: es.until } : {}), ...(es.status === "read_only" ? { readOnlyFrom: now } : {}),
          } });
          if (changed.count) {
            out.statusChanges++;
            await db.subscriptionEvent.create({ data: { subscriptionId: s.id, tenantId: t.id, appId: s.appId, type: s.status === "trialing" ? "trial_ended" : es.status, fromStatus: s.status, toStatus: es.status, fromEdition: s.editionId, toEdition: es.edition, actorKind: "system", at: now } });
            const msg = MESSAGES[es.status]?.(nameOf(s.appId)) ?? (s.status === "trialing" ? { title: `${nameOf(s.appId)} trial ended`, message: `Your ${nameOf(s.appId)} trial has ended. Buy it to keep the paid features.` } : null);
            if (msg) await tell(db, t.id, { type: "billing", ...msg });
          }
        }

        // 2 and 3: paid periods that are running and will renew.
        const end = s.currentPeriodEnd;
        if (s.periodMonths == null || !end || s.cancelAtPeriodEnd || s.status === "cancelled") continue;
        if (es.status !== "active" && es.status !== "past_due") continue;
        const daysLeft = nepalDays(now, end);
        const first = Math.max(...settings.reminderDays, 0);
        if (daysLeft <= first) due.push(s.appId);
        for (const d of settings.reminderDays) {
          if (daysLeft > d || daysLeft < 0) continue;
          const type = `reminder_${d}`;
          const sent = await db.subscriptionEvent.findFirst({ where: { subscriptionId: s.id, type, at: { gte: s.currentPeriodStart ?? new Date(0) } }, select: { id: true } });
          if (sent) continue;
          await db.subscriptionEvent.create({ data: { subscriptionId: s.id, tenantId: t.id, appId: s.appId, type, actorKind: "system", at: now } });
          await tell(db, t.id, { type: "billing", title: `${nameOf(s.appId)} renews in ${d} day${d === 1 ? "" : "s"}`, message: `Your ${nameOf(s.appId)} period ends on ${end.toISOString().slice(0, 10)}. The renewal invoice is in Billing.` });
          out.reminders++;
        }
      }

      // One renewal invoice per business for what is due and not yet invoiced for its next period.
      const open = due.length ? await db.invoiceLine.findMany({ where: { appId: { in: due }, kind: "subscription", invoice: { tenantId: t.id, kind: "subscription", status: { in: ["open", "paid"] } } }, select: { appId: true, periodStart: true } }) : [];
      const toRenew = subs.filter((s) => due.includes(s.appId) && !open.some((l) => l.appId === s.appId && l.periodStart && s.currentPeriodEnd && l.periodStart.getTime() >= s.currentPeriodEnd.getTime()));
      if (toRenew.length) {
        const state = subs.map((s) => {
          const st = toState(s);
          // A waiting downgrade or year-to-month switch takes effect with the renewal, at the catalog price of the new choice.
          if (s.pendingEditionId || s.pendingPeriodMonths) {
            const ed = s.pendingEditionId ?? s.editionId, months = s.pendingPeriodMonths ?? s.periodMonths ?? 1;
            const e = catalog.apps[s.appId]?.editions[ed];
            if (e) return { ...st, editionId: ed, periodMonths: months, priceGrossPaisa: months === 12 ? e.priceYearPaisa : e.priceMonthPaisa };
          }
          return st;
        });
        const monthly = subs.find((s) => s.periodMonths === 1 && s.currentPeriodEnd);
        const lock = t.billingLock ? { legacyMonthlyGrossPaisa: Number(t.billingLock.legacyMonthlyGrossPaisa), legacyPeriodMonths: t.billingLock.legacyPeriodMonths, coversApps: t.billingLock.coversApps, lockEnd: t.billingLock.lockEnd } : null;
        const q = quote({
          now, catalog, settings: { ...settings, salesEnabled: true },
          business: { anchorDay: monthly?.currentPeriodEnd ? anchorOf(monthly.currentPeriodEnd) : null, subscriptions: state, lock },
          items: toRenew.map((s) => ({ kind: "renew" as const, appId: s.appId })),
        });
        if (q.errors.length) { o.log.warn({ tenantId: t.id, errors: q.errors }, "subscription renewal: the quote was refused"); out.failures++; continue; }
        await db.$transaction((tx) => createInvoiceFromQuote(tx, { tenantId: t.id, quote: { ...q, dueAt: toRenew[0]!.currentPeriodEnd ?? q.dueAt }, by: null, billedTo: { name: t.name }, catalogVersion: catalog.version }));
        out.renewalInvoices++;
      }
    } catch (e) {
      out.failures++;
      o.log.error({ err: e, tenantId: t.id }, "subscription lifecycle failed for one business");
    }
  }
  return out;
}
