// Plan billing: invoices, applying a payment, the renewal cycle, and businesses covered by a Pro plan.
// Where it fits: used by the business API (checkout, payment return, bank proofs) and the admin API (payment review,
// the renewal job every 6 hours, plan changes).
// How it works: an invoice is made for a plan and period; once a gateway or Sheetal confirms the payment, the plan and
// its end date are applied. Before the end date a renewal invoice and reminders go out; after it, a grace period;
// then the business moves to Starter.
// Rules: prices include 13% VAT. Nothing charges anyone automatically (Nepal wallets keep no cards on file).
// Applying a payment is safe to repeat. Covered businesses follow their Pro business's plan.

import type { Invoice, Plan, Prisma, Tenant } from "@prisma/client";
import type { Db } from "../lib/db.js";
import type { Mailer } from "../lib/mailer.js";
import { Vault } from "../lib/vault.js";
import { ESEWA_TEST, type Mode } from "../lib/payments.js";
import { notify } from "../lib/notify.js";
import { priceFor, starterPlanId } from "./plans.js";
import type { BusinessType } from "./permissions.js";

export interface BillingSettings { vatRate: number; graceDays: number; reminderDays: number[]; bank: { name?: string; account?: string; accountName?: string; note?: string } }
const BILLING_DEFAULTS: BillingSettings = { vatRate: 13, graceDays: 7, reminderDays: [7, 1], bank: {} };

export async function billingSettings(db: Db): Promise<BillingSettings> {
  const row = await db.appSetting.findUnique({ where: { key: "billing" } });
  return { ...BILLING_DEFAULTS, ...((row?.value as Partial<BillingSettings>) ?? {}) };
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
  return db.invoice.create({
    data: {
      tenantId: o.tenant.id, planId: o.plan.id, months: o.months, ...splitVat(priceFor(o.plan.price, o.months), o.vatRate),
      billedTo: { name: o.tenant.name, pan: o.tenant.pan, vatRegistered: o.tenant.vatRegistered, email: o.tenant.email, phone: o.tenant.phone, city: o.tenant.city, address: o.tenant.address },
      periodStart: start, periodEnd: end, dueAt: new Date(now.getTime() + (o.dueInDays ?? 7) * 864e5), createdBy: o.by,
    },
  });
}

async function ownerOf(db: Db, tenantId: string) {
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
    const { start, end } = periodFor(tenant, p.invoice.planId, p.invoice.months, now);
    await tx.payment.update({ where: { id: p.id }, data: { status: "paid", paidAt: now, providerRef: o.providerRef ?? p.providerRef, raw: (o.raw ?? p.raw ?? undefined) as Prisma.InputJsonValue | undefined, reviewedBy: o.reviewedBy } });
    await tx.invoice.update({ where: { id: p.invoiceId }, data: { status: "paid", paidAt: now, periodStart: start, periodEnd: end } });
    await tx.tenant.update({ where: { id: tenant.id }, data: { planId: p.invoice.planId, period: p.invoice.months, renewsAt: end, status: "active", graceUntil: null, remindedFor: null } });
    // Its own bill now: it stops being covered by another business; businesses it covers follow its new plan.
    if (tenant.coveredById) await tx.tenant.update({ where: { id: tenant.id }, data: { coveredById: null } });
    await syncCovered(tx, tenant.id);
    await tx.auditLog.create({ data: { actorId: o.reviewedBy, tenantId: tenant.id, action: "billing.paid", target: `${invoiceNumber(p.invoice)} · ${p.provider} · Rs. ${p.amount}` } });
    return { p, tenant, end };
  });
  if (!done) return false;
  const plan = await db.plan.findUnique({ where: { id: done.p.invoice.planId } });
  const owner = await ownerOf(db, done.tenant.id);
  const to = owner?.email ?? done.tenant.email;
  const number = invoiceNumber(done.p.invoice);
  if (to) {
    await mailer.send({
      to, subject: `Payment received: ${number}`,
      text: `Namaste ${owner?.userName ?? done.tenant.name},\n\nWe received Rs. ${done.p.amount.toLocaleString("en-IN")} for ${plan?.name ?? "your plan"} (${done.p.invoice.months} month${done.p.invoice.months > 1 ? "s" : ""}). ${done.tenant.name} is paid until ${day(done.end)}.\n\nInvoice ${number}: ${o.siteUrl.replace(/\/$/, "")}/business/billing\n\nSheetal Property`,
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
  const out = { reminded: 0, pastDue: 0, downgraded: 0 };
  const tenants = await db.tenant.findMany({ where: { renewsAt: { not: null }, status: { in: ["active", "trial", "past_due"] }, plan: { price: { gt: 0 } } }, include: { plan: true } });

  for (const t of tenants) {
    const renews = t.renewsAt!;
    const owner = await ownerOf(db, t.id);
    const to = owner?.email ?? t.email;
    const tell = async (subject: string, text: string, title: string) => {
      if (to) await mailer.send({ to, subject, text: `Namaste ${owner?.userName ?? t.name},\n\n${text}\n\n${site}/business/billing\n\nSheetal Property` });
      await notify(db, [owner?.id], { tenantId: t.id, type: "billing", title, link: "/business/billing" });
    };

    if (t.status !== "past_due" && renews > now) {
      const daysLeft = Math.ceil((renews.getTime() - now.getTime()) / 864e5);
      const due = [...s.reminderDays].sort((a, b) => a - b).find((d) => daysLeft <= d);
      const key = due !== undefined ? `${day(renews)}:${due}` : null;
      if (key && t.remindedFor !== key) {
        // A renewal invoice for the same plan and period, made once.
        const open = await db.invoice.findFirst({ where: { tenantId: t.id, status: "open", planId: t.planId } });
        if (!open) await createInvoice(db, { tenant: t, plan: t.plan, months: t.period, vatRate: s.vatRate, dueInDays: daysLeft, now });
        await db.tenant.update({ where: { id: t.id }, data: { remindedFor: key } });
        await tell(`${t.name}: ${t.plan.name} renews in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`,
          `${t.name}'s ${t.plan.name} plan is paid until ${day(renews)}. The renewal invoice is ready; pay it by eSewa, Khalti, Fonepay or bank transfer to keep everything running.`,
          `${t.plan.name} renews in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`);
        out.reminded++;
      }
      continue;
    }

    if (t.status !== "past_due" && renews <= now) {
      const graceUntil = new Date(renews.getTime() + s.graceDays * 864e5);
      await db.tenant.update({ where: { id: t.id }, data: { status: "past_due", graceUntil } });
      await db.auditLog.create({ data: { tenantId: t.id, action: "billing.past_due", target: t.name } });
      await tell(`${t.name}: payment due`, `${t.name}'s ${t.plan.name} plan ended on ${day(renews)}. Everything keeps working until ${day(graceUntil)}; after that the business moves to the free Starter plan.`, "Your plan payment is due");
      out.pastDue++;
      continue;
    }

    if (t.status === "past_due" && t.graceUntil && t.graceUntil <= now) {
      await db.$transaction([
        db.tenant.update({ where: { id: t.id }, data: { planId: starterPlanId(t.type as BusinessType), status: "active", period: 1, renewsAt: null, graceUntil: null, remindedFor: null } }),
        db.invoice.updateMany({ where: { tenantId: t.id, status: "open" }, data: { status: "void" } }),
        db.auditLog.create({ data: { tenantId: t.id, action: "billing.moved_to_starter", target: t.name } }),
      ]);
      await syncCovered(db, t.id);
      await tell(`${t.name} is now on Starter`, `The ${t.plan.name} plan wasn't renewed, so ${t.name} is on the free Starter plan now. Your listings and data stay; Starter's limits apply to anything new. Pay for a plan any time to get everything back.`, "Moved to the free Starter plan");
      out.downgraded++;
    }
  }
  return out;
}
