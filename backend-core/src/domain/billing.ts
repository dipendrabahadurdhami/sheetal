// Plan billing: invoices, applying a payment, the renewal cycle, and businesses covered by a Pro plan.
// Where it fits: used by the business API (checkout, payment return, bank proofs) and the admin API (payment review,
// the renewal job every 6 hours, plan changes).
// How it works: an invoice is made for a plan and period; once a gateway or Sheetal confirms the payment, the plan and
// its end date are applied. Before the end date a renewal invoice and reminders go out; after it, a grace period;
// then the business moves to Starter.
// Boost invoices (kind "boost") start their boosts when paid (domain/promote.ts).
// Rules: prices include 13% VAT. Nothing charges anyone automatically (Nepal wallets keep no cards on file).
// Applying a payment is safe to repeat. Covered businesses follow their Pro business's plan.

import type { Invoice, Plan, Prisma, Tenant } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import type { Mailer } from "../lib/mailer.js";
import { Vault } from "@sheetal/platform/auth/vault";
import { ESEWA_TEST, type Mode } from "../lib/payments.js";
import { notify, notifyStaff } from "@sheetal/platform/notify/index";
import { priceFor, starterPlanId } from "./plans.js";
import type { BusinessType } from "./permissions.js";
import { applyAddonLines, endAddons, linesTotal, renewalLines, type AddonLine } from "./addons.js";
import { activateBoosts } from "./promote.js";
import { platformSaved, platformSettings } from "./platform.js";
import { payBanners } from "./banners.js";
import { SettingsService } from "@sheetal/platform/settings/service";
import { REVENUE_SHARE } from "@sheetal/platform/settings/defs";
import { applySubscriptionPayment } from "@sheetal/platform/billing/invoice";

/** The settings store only logs a stored value that no longer fits its definition (it then uses the default). */
const QUIET = { warn: () => undefined };

export interface BillingSettings { vatRate: number; graceDays: number; autoSuspend: boolean; reminderDays: number[]; bank: { name?: string; account?: string; accountName?: string; note?: string } }
const BILLING_DEFAULTS: BillingSettings = { vatRate: 13, graceDays: 7, autoSuspend: true, reminderDays: [7, 1], bank: {} };

export async function billingSettings(db: Db): Promise<BillingSettings> {
  // VAT and grace days belong to the platform settings (Admin → Settings); the billing row is only the fallback for
  // a platform that never saved them, and holds reminders and bank details.
  const [row, saved, p] = await Promise.all([db.appSetting.findUnique({ where: { key: "billing" } }), platformSaved(db), platformSettings(db)]);
  const out = { ...BILLING_DEFAULTS, ...((row?.value as Partial<BillingSettings>) ?? {}), autoSuspend: p.autoSuspend };
  if (saved.vatRate !== undefined) out.vatRate = p.vatRate;
  if (saved.graceDays !== undefined) out.graceDays = p.graceDays;
  return out;
}

/** Gateway settings as stored (secrets sealed). */
export interface StoredGateways {
  esewa?: { enabled: boolean; mode: Mode; productCode?: string; secretKey?: string };
  khalti?: { enabled: boolean; mode: Mode; secretKey?: string };
  fonepay?: { enabled: boolean; mode: Mode; merchantCode?: string; secretKey?: string };
  manual?: { enabled: boolean };
}
export interface Gateways {
  esewa: { mode: Mode; productCode: string; secretKey: string } | null;
  khalti: { mode: Mode; secretKey: string } | null;
  fonepay: { mode: Mode; merchantCode: string; secretKey: string } | null;
  manual: boolean;
}

/** The gateways that can take payments now, with their secrets opened. Outside production, eSewa's public test
 *  merchant works until real keys are saved, so the whole flow can be tried locally. */
export async function gateways(db: Db, vault: Vault, production: boolean): Promise<Gateways> {
  const s = ((await db.appSetting.findUnique({ where: { key: "payments" } }))?.value ?? {}) as StoredGateways;
  const open = (v?: string) => { try { return v ? vault.open(v) : null; } catch { return null; } };
  const e = s.esewa, k = s.khalti, f = s.fonepay;
  const esewaKey = open(e?.secretKey);
  return {
    esewa: e?.enabled && e.productCode && esewaKey ? { mode: e.mode, productCode: e.productCode, secretKey: esewaKey }
      : !production && e?.enabled !== false ? { mode: "test", ...ESEWA_TEST } : null,
    khalti: k?.enabled && open(k.secretKey) ? { mode: k.mode, secretKey: open(k.secretKey)! } : null,
    fonepay: f?.enabled && f.merchantCode && open(f.secretKey) ? { mode: f.mode, merchantCode: f.merchantCode, secretKey: open(f.secretKey)! } : null,
    manual: s.manual?.enabled !== false,
  };
}

export const splitVat = (total: number, rate: number) => { const vat = Math.round((total * rate) / (100 + rate)); return { subtotal: total - vat, vat, total }; };
export const invoiceNumber = (i: Pick<Invoice, "seq" | "createdAt">) => `INV-${i.createdAt.getFullYear()}-${String(i.seq).padStart(4, "0")}`;
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** When a payment for this plan would start: after the current paid period when it's the same plan, else now. */
export function periodFor(tenant: Pick<Tenant, "planId" | "renewsAt">, planId: string, months: number, now = new Date()) {
  const start = tenant.planId === planId && tenant.renewsAt && tenant.renewsAt > now ? tenant.renewsAt : now;
  return { start, end: addMonths(start, months) };
}

export async function createInvoice(db: Db | Prisma.TransactionClient, o: { tenant: Tenant; plan: Plan; months: number; by?: string; vatRate: number; dueInDays?: number; now?: Date }) {
  if (!o.plan.price) throw new Error("Starter is free; there is nothing to bill.");
  const now = o.now ?? new Date();
  const { start, end } = periodFor(o.tenant, o.plan.id, o.months, now);
  // The add-ons the business keeps renew with the plan (only when it stays on the same plan).
  const lines = o.tenant.planId === o.plan.id ? await renewalLines(db, o.tenant.id, o.months) : [];
  return db.invoice.create({
    data: {
      tenantId: o.tenant.id, planId: o.plan.id, months: o.months, kind: "plan", addons: lines as unknown as Prisma.InputJsonValue, ...splitVat(priceFor(o.plan.price, o.months) + linesTotal(lines), o.vatRate),
      billedTo: { name: o.tenant.name, pan: o.tenant.pan, vatRegistered: o.tenant.vatRegistered, email: o.tenant.email, phone: o.tenant.phone, city: o.tenant.city, address: o.tenant.address },
      periodStart: start, periodEnd: end, dueAt: new Date(now.getTime() + (o.dueInDays ?? 7) * 864e5), createdBy: o.by,
    },
  });
}

/** An invoice for add-ons bought now, for the rest of the paid period. */
export async function createAddonInvoice(db: Tx, o: { tenant: Tenant; lines: AddonLine[]; by?: string; vatRate: number; now?: Date }) {
  const now = o.now ?? new Date();
  return db.invoice.create({
    data: {
      tenantId: o.tenant.id, planId: o.tenant.planId, months: o.lines[0]?.months ?? 1, kind: "addon", addons: o.lines as unknown as Prisma.InputJsonValue, ...splitVat(linesTotal(o.lines), o.vatRate),
      billedTo: { name: o.tenant.name, pan: o.tenant.pan, vatRegistered: o.tenant.vatRegistered, email: o.tenant.email, phone: o.tenant.phone, city: o.tenant.city, address: o.tenant.address },
      periodStart: now, periodEnd: o.tenant.renewsAt, dueAt: new Date(now.getTime() + 7 * 864e5), createdBy: o.by,
    },
  });
}

/** Open plan invoices are priced again with the add-ons the business keeps now (after it buys or removes one). */
export async function repriceOpenPlanInvoices(db: Tx, tenantId: string) {
  const [open, s, t] = await Promise.all([db.invoice.findMany({ where: { tenantId, status: "open", kind: "plan" }, include: { payments: { where: { status: { in: ["initiated", "pending_review"] } }, select: { id: true } } } }), billingSettings(db as Db), db.tenant.findUniqueOrThrow({ where: { id: tenantId } })]);
  for (const i of open) {
    if (i.payments.length || i.planId !== t.planId) continue; // someone is paying it now, or it is for another plan
    const plan = await db.plan.findUniqueOrThrow({ where: { id: i.planId ?? t.planId } });
    const lines = await renewalLines(db, tenantId, i.months);
    await db.invoice.update({ where: { id: i.id }, data: { addons: lines as unknown as Prisma.InputJsonValue, ...splitVat(priceFor(plan.price, i.months) + linesTotal(lines), s.vatRate) } });
  }
}

export async function ownerOf(db: Db, tenantId: string) {
  const m = await db.membership.findFirst({ where: { tenantId, status: "active", role: { key: "owner" } }, orderBy: { createdAt: "asc" }, select: { user: { select: { id: true, email: true, userName: true } } } });
  return m?.user ?? null;
}

/**
 * Marks a payment paid and applies its invoice: the plan, period and paid-until date. Safe to call twice (a gateway
 * may send the payer back more than once); only the first call changes anything. Returns false if already applied.
 */
// ───── Businesses covered by a Pro plan ─────
// An owner's other businesses can be covered by one of their businesses on Pro: they get Pro for their own type,
// with no bill of their own (renewsAt stays empty, so the renewal cycle skips them). They follow that business:
// Pro while it has Pro (grace period included), Starter when it doesn't, and Pro again when it is paid again.

type Tx = Db | Prisma.TransactionClient;
/** Whether a business's plan is Pro, the one that can cover others. */
export const isPro = (plan: { price: number; features: unknown }) => plan.price > 0 && !!(plan.features as Record<string, boolean> | null)?.all_kinds;

/** Puts every business covered by `parentId` on Pro (of its own type) or back on Starter, following the parent. */
export async function syncCovered(db: Tx, parentId: string) {
  const parent = await db.tenant.findUnique({ where: { id: parentId }, include: { plan: true } });
  const on = !!parent && isPro(parent.plan) && parent.status !== "suspended" && parent.status !== "cancelled";
  const kids = await db.tenant.findMany({ where: { coveredById: parentId } });
  for (const k of kids) {
    const planId = on ? `${k.type}-pro` : starterPlanId(k.type as BusinessType);
    if (k.planId !== planId) await db.tenant.update({ where: { id: k.id }, data: { planId, period: 1, renewsAt: null, graceUntil: null, remindedFor: null, ...(k.status === "past_due" ? { status: "active" } : {}) } });
  }
  return kids.length;
}

export async function applyPayment(db: Db, mailer: Mailer, o: { paymentId: string; providerRef?: string; raw?: unknown; reviewedBy?: string; siteUrl: string }) {
  const now = new Date();
  const done = await db.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: o.paymentId }, include: { invoice: true } });
    if (!p) throw new Error("Payment not found");
    if (p.status === "paid" || p.invoice.status === "paid") return null;
    if (p.invoice.status === "void") throw new Error("This invoice was cancelled.");
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: p.tenantId } });
    if (p.invoice.kind === "subscription") {
      // Phase 3: per-app subscriptions (platform/src/billing/invoice.ts): tax invoice number at payment, subscriptions, revenue rows.
      const share = await new SettingsService(db, QUIET).get(REVENUE_SHARE);
      const seller = { name: (await platformSettings(db)).siteName };
      const r = await applySubscriptionPayment(tx, { paymentId: p.id, now, providerRef: o.providerRef ?? null, raw: o.raw, reviewedBy: o.reviewedBy ?? null, appSales: share.appSales, share, seller });
      return r.applied ? { p, tenant, end: now, v3: true as const } : null;
    }
    if (p.invoice.kind === "banner") {
      // A home page banner: paid, it waits for Sheetal to check the picture.
      await tx.payment.update({ where: { id: p.id }, data: { status: "paid", paidAt: now, providerRef: o.providerRef ?? p.providerRef, raw: (o.raw ?? p.raw ?? undefined) as Prisma.InputJsonValue | undefined, reviewedBy: o.reviewedBy } });
      await tx.invoice.update({ where: { id: p.invoiceId }, data: { status: "paid", paidAt: now } });
      await payBanners(tx, p.invoiceId, now);
      await tx.auditLog.create({ data: { actorId: o.reviewedBy, tenantId: tenant.id, action: "billing.banner_paid", target: `${invoiceNumber(p.invoice)} · ${p.provider} · Rs. ${p.amount}` } });
      return { p, tenant, end: tenant.renewsAt ?? now };
    }
    if (p.invoice.kind === "boost") {
      // Boosts on the website: they start on their dates; the plan stays as it is.
      await tx.payment.update({ where: { id: p.id }, data: { status: "paid", paidAt: now, providerRef: o.providerRef ?? p.providerRef, raw: (o.raw ?? p.raw ?? undefined) as Prisma.InputJsonValue | undefined, reviewedBy: o.reviewedBy } });
      await tx.invoice.update({ where: { id: p.invoiceId }, data: { status: "paid", paidAt: now } });
      await activateBoosts(tx, p.invoiceId, now);
      await tx.auditLog.create({ data: { actorId: o.reviewedBy, tenantId: tenant.id, action: "billing.boost_paid", target: `${invoiceNumber(p.invoice)} · ${p.provider} · Rs. ${p.amount}` } });
      return { p, tenant, end: tenant.renewsAt ?? now };
    }
    if (p.invoice.kind === "addon") {
      // Add-ons bought for the rest of the period: the plan and its dates stay as they are.
      await tx.payment.update({ where: { id: p.id }, data: { status: "paid", paidAt: now, providerRef: o.providerRef ?? p.providerRef, raw: (o.raw ?? p.raw ?? undefined) as Prisma.InputJsonValue | undefined, reviewedBy: o.reviewedBy } });
      await tx.invoice.update({ where: { id: p.invoiceId }, data: { status: "paid", paidAt: now } });
      await applyAddonLines(tx, tenant.id, "addon", p.invoice.addons as unknown as AddonLine[]);
      await tx.auditLog.create({ data: { actorId: o.reviewedBy, tenantId: tenant.id, action: "billing.addons_paid", target: `${invoiceNumber(p.invoice)} · ${p.provider} · Rs. ${p.amount}` } });
      return { p, tenant, end: tenant.renewsAt ?? now };
    }
    // Only old plan invoices reach this line; they always carry a plan (Phase 3 invoices take their own path).
    const planId = p.invoice.planId ?? tenant.planId;
    const { start, end } = periodFor(tenant, planId, p.invoice.months, now);
    await tx.payment.update({ where: { id: p.id }, data: { status: "paid", paidAt: now, providerRef: o.providerRef ?? p.providerRef, raw: (o.raw ?? p.raw ?? undefined) as Prisma.InputJsonValue | undefined, reviewedBy: o.reviewedBy } });
    await tx.invoice.update({ where: { id: p.invoiceId }, data: { status: "paid", paidAt: now, periodStart: start, periodEnd: end } });
    await tx.tenant.update({ where: { id: tenant.id }, data: { planId, period: p.invoice.months, renewsAt: end, status: "active", graceUntil: null, remindedFor: null } });
    // Its own bill now: it stops being covered by another business; businesses it covers follow its new plan.
    if (tenant.coveredById) await tx.tenant.update({ where: { id: tenant.id }, data: { coveredById: null } });
    await syncCovered(tx, tenant.id);
    // Add-ons follow the plan: the ones kept renew with it; on another plan they end.
    if (tenant.planId === planId) await applyAddonLines(tx, tenant.id, "plan", p.invoice.addons as unknown as AddonLine[]);
    else await endAddons(tx, tenant.id);
    await tx.auditLog.create({ data: { actorId: o.reviewedBy, tenantId: tenant.id, action: "billing.paid", target: `${invoiceNumber(p.invoice)} · ${p.provider} · Rs. ${p.amount}` } });
    return { p, tenant, end };
  });
  if (!done) return false;
  if ("v3" in done) return true; // Phase 3 mails come with the lifecycle job (P3-BE-5)
  if (done.p.invoice.kind === "addon") await repriceOpenPlanInvoices(db, done.tenant.id);
  const plan = done.p.invoice.planId ? await db.plan.findUnique({ where: { id: done.p.invoice.planId } }) : null;
  const owner = await ownerOf(db, done.tenant.id);
  const to = owner?.email ?? done.tenant.email;
  const number = invoiceNumber(done.p.invoice);
  if (done.p.invoice.kind === "banner") {
    if (to) await mailer.send({ to, subject: `Payment received: ${number}`, text: `Namaste ${owner?.userName ?? done.tenant.name},\n\nWe received Rs. ${done.p.amount.toLocaleString("en-IN")} for your home page banner. Sheetal checks the picture (usually within a working day); it then shows on its dates by itself.\n\n${o.siteUrl.replace(/\/$/, "")}/business/promote/banner\n\nSheetal Property`, template: { key: "payment_banner", vars: { name: owner?.userName ?? done.tenant.name, amount: done.p.amount.toLocaleString("en-IN"), number, link: `${o.siteUrl.replace(/\/$/, "")}/business/promote/banner` } } });
    await notify(db, [owner?.id, done.p.userId], { tenantId: done.tenant.id, type: "billing", title: `Banner paid: ${number}`, message: "Sheetal checks the picture next.", link: "/business/promote/banner" });
    await notifyStaff(db, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete", { type: "promote", title: `Banner picture to check: ${done.tenant.name}`, message: number, link: "/admin/promote" });
    return true;
  }
  if (done.p.invoice.kind === "boost") {
    if (to) await mailer.send({ to, subject: `Payment received: ${number}`, text: `Namaste ${owner?.userName ?? done.tenant.name},\n\nWe received Rs. ${done.p.amount.toLocaleString("en-IN")} for your boost. It runs on its dates by itself; see how it does in Business → Promote.\n\n${o.siteUrl.replace(/\/$/, "")}/business/promote\n\nSheetal Property`, template: { key: "payment_boost", vars: { name: owner?.userName ?? done.tenant.name, amount: done.p.amount.toLocaleString("en-IN"), number, link: `${o.siteUrl.replace(/\/$/, "")}/business/promote` } } });
    await notify(db, [owner?.id, done.p.userId], { tenantId: done.tenant.id, type: "billing", title: `Boost paid: ${number}`, message: "It runs on its dates by itself.", link: "/business/promote" });
    return true;
  }
  if (to) {
    await mailer.send({
      to, subject: `Payment received: ${number}`,
      text: `Namaste ${owner?.userName ?? done.tenant.name},\n\nWe received Rs. ${done.p.amount.toLocaleString("en-IN")} for ${done.p.invoice.kind === "addon" ? "add-ons" : `${plan?.name ?? "your plan"} (${done.p.invoice.months} month${done.p.invoice.months > 1 ? "s" : ""})`}. ${done.tenant.name} is paid until ${day(done.end)}.\n\nInvoice ${number}: ${o.siteUrl.replace(/\/$/, "")}/business/billing\n\nSheetal Property`,
      template: { key: "payment_plan", vars: { name: owner?.userName ?? done.tenant.name, amount: done.p.amount.toLocaleString("en-IN"), what: done.p.invoice.kind === "addon" ? "add-ons" : `${plan?.name ?? "your plan"} (${done.p.invoice.months} month${done.p.invoice.months > 1 ? "s" : ""})`, business: done.tenant.name, until: day(done.end), number, link: `${o.siteUrl.replace(/\/$/, "")}/business/billing` } },
    });
  }
  await notify(db, [owner?.id], { tenantId: done.tenant.id, type: "billing", title: `Payment received: ${number}`, message: `Paid until ${day(done.end)}`, link: "/business/billing" });
  return true;
}

/**
 * The daily renewal cycle for paid plans. Run once a day (more often is harmless):
 * reminders N days before the paid period ends (with a renewal invoice ready to pay), past due when it ends,
 * and after the grace period, back to the free Starter plan. Listings are never hidden by this; only the
 * Starter limits apply to new ones.
 */
export async function runBillingCycle(db: Db, mailer: Mailer, o: { siteUrl: string; now?: Date }) {
  const now = o.now ?? new Date();
  const s = await billingSettings(db);
  const site = o.siteUrl.replace(/\/$/, "");
  const out = { reminded: 0, pastDue: 0, downgraded: 0, trialsEnded: 0 };
  const tenants = await db.tenant.findMany({ where: { renewsAt: { not: null }, status: { in: ["active", "trial", "past_due"] }, plan: { price: { gt: 0 } } }, include: { plan: true } });

  for (const t of tenants) {
    const renews = t.renewsAt!;
    const owner = await ownerOf(db, t.id);
    const to = owner?.email ?? t.email;
    const tell = async (subject: string, text: string, title: string, tpl?: { key: string; vars: Record<string, string> }) => {
      if (to) await mailer.send({ to, subject, text: `Namaste ${owner?.userName ?? t.name},\n\n${text}\n\n${site}/business/billing\n\nSheetal Property`, template: tpl && { key: tpl.key, vars: { name: owner?.userName ?? t.name, business: t.name, link: `${site}/business/billing`, ...tpl.vars } } });
      await notify(db, [owner?.id], { tenantId: t.id, type: "billing", title, link: "/business/billing" });
    };

    if (t.status !== "past_due" && renews > now) {
      const daysLeft = Math.ceil((renews.getTime() - now.getTime()) / 864e5);
      const due = [...s.reminderDays].sort((a, b) => a - b).find((d) => daysLeft <= d);
      const key = due !== undefined ? `${day(renews)}:${due}` : null;
      if (key && t.remindedFor !== key) {
        // A renewal invoice for the same plan and period, made once.
        const open = await db.invoice.findFirst({ where: { tenantId: t.id, status: "open", planId: t.planId, kind: "plan" } });
        if (!open) await createInvoice(db, { tenant: t, plan: t.plan, months: t.period, vatRate: s.vatRate, dueInDays: daysLeft, now });
        await db.tenant.update({ where: { id: t.id }, data: { remindedFor: key } });
        await tell(`${t.name}: ${t.plan.name} renews in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`,
          `${t.name}'s ${t.plan.name} plan is paid until ${day(renews)}. The renewal invoice is ready; pay it by eSewa, Khalti, Fonepay or bank transfer to keep everything running.`,
          `${t.plan.name} renews in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`, { key: "plan_renews", vars: { plan: t.plan.name, in: `${daysLeft} day${daysLeft > 1 ? "s" : ""}`, until: day(renews) } });
        out.reminded++;
      }
      continue;
    }

    // A free trial that ends unpaid moves straight to Starter: no grace period, no unpaid invoice left behind.
    if (t.status === "trial" && renews <= now) {
      await db.$transaction([
        db.tenant.update({ where: { id: t.id }, data: { planId: starterPlanId(t.type as BusinessType), status: "active", period: 1, renewsAt: null, graceUntil: null, remindedFor: null } }),
        db.invoice.updateMany({ where: { tenantId: t.id, status: "open" }, data: { status: "void" } }),
        endAddons(db, t.id),
        db.auditLog.create({ data: { tenantId: t.id, action: "billing.trial_ended", target: t.name } }),
      ]);
      await syncCovered(db, t.id);
      await tell(`${t.name}: free trial ended`, `${t.name}'s free trial of ${t.plan.name} ended on ${day(renews)}, so the business is on the free Starter plan now. Your listings and data stay; Starter's limits apply to anything new. Choose a plan any time to get everything back.`, "Your free trial has ended");
      out.trialsEnded++;
      continue;
    }

    if (t.status !== "past_due" && renews <= now) {
      const graceUntil = new Date(renews.getTime() + s.graceDays * 864e5);
      await db.tenant.update({ where: { id: t.id }, data: { status: "past_due", graceUntil } });
      await db.auditLog.create({ data: { tenantId: t.id, action: "billing.past_due", target: t.name } });
      await tell(`${t.name}: payment due`, `${t.name}'s ${t.plan.name} plan ended on ${day(renews)}. Everything keeps working until ${day(graceUntil)}; after that the business moves to the free Starter plan.`, "Your plan payment is due", { key: "plan_past_due", vars: { plan: t.plan.name, until: day(renews), date: day(graceUntil) } });
      out.pastDue++;
      continue;
    }

    if (s.autoSuspend && t.status === "past_due" && t.graceUntil && t.graceUntil <= now) {
      await db.$transaction([
        db.tenant.update({ where: { id: t.id }, data: { planId: starterPlanId(t.type as BusinessType), status: "active", period: 1, renewsAt: null, graceUntil: null, remindedFor: null } }),
        db.invoice.updateMany({ where: { tenantId: t.id, status: "open" }, data: { status: "void" } }),
        endAddons(db, t.id),
        db.auditLog.create({ data: { tenantId: t.id, action: "billing.moved_to_starter", target: t.name } }),
      ]);
      await syncCovered(db, t.id);
      await tell(`${t.name} is now on Starter`, `The ${t.plan.name} plan wasn't renewed, so ${t.name} is on the free Starter plan now. Your listings and data stay; Starter's limits apply to anything new. Pay for a plan any time to get everything back.`, "Moved to the free Starter plan", { key: "plan_to_starter", vars: { plan: t.plan.name } });
      out.downgraded++;
    }
  }
  return out;
}
