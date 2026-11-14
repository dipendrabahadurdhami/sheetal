// Phase 3 invoices (MARKETPLACE-AND-BILLING.md sections 9 and 13): the invoice stored from a quote, the tax invoice number given AT PAYMENT,
// applying a paid subscription invoice, the revenue ledger with commission and the technology partner's share, and credit notes.
// Where it fits: the checkout (P3-BE-6) calls createInvoiceFromQuote(); backend-core/src/domain/billing.ts applyPayment() sends invoices of
// kind "subscription" here (old kinds plan, addon, boost and banner keep their old path); refunds (P3-BE-7) call issueCreditNote().
// How it works:
//   - numbers come from one DocCounter row per fiscal year (tenant "__platform__", key "INV:2083-84"), raised with one atomic upsert inside the
//     payment transaction: two payments at once get consecutive numbers, and a failed payment rolls its number back (no gaps). A zero total
//     takes no number (no tax invoice for a free purchase). Credit notes share the sequence (shown as CN-…) so (fy, no) stays unique.
//   - the fiscal year is Nepal's (Shrawan 1, in Nepal time: 00:30 on Shrawan 1 Nepal is already the new year).
//   - applying locks the invoice row first, so the payer returning twice (or two returns at once) applies it once.
//   - one RevenueEntry per invoice line, from the stored amounts: commission = the app-sales rate of the line's app, partner share = its
//     part of the commission; every split adds back (the database checks it). Test-mode payments make no revenue.
// Rules: money in paisa (BigInt in the database). An issued invoice never changes (a trigger refuses); a refund is a credit note with the
// ORIGINAL percentages read back from the revenue rows.

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { pctOf, partnerShareOf, type RevenueShare } from "../settings/revenue-share.js";
import type { Quote } from "./types.js";

type Tx = Prisma.TransactionClient;
export const PLATFORM_TENANT = "__platform__";

/** Shrawan 1 (AD date, Nepal calendar) of each year. Checked against the official calendar before each Shrawan (the yearly checklist). */
const SHRAWAN_1: Record<number, string> = { 2025: "07-17", 2026: "07-17", 2027: "07-17", 2028: "07-16", 2029: "07-16", 2030: "07-17" };
const OFFSET_MS = (5 * 60 + 45) * 60_000;

/** "2083-84": the Nepal fiscal year of an instant, in Nepal time. */
export function fiscalYear(d: Date): string {
  const n = new Date(d.getTime() + OFFSET_MS); // the Nepal wall clock
  const y = n.getUTCFullYear();
  const s = SHRAWAN_1[y] ?? "07-17";
  const start = Date.UTC(y, Number(s.slice(0, 2)) - 1, Number(s.slice(3)));
  const bs = (n.getTime() >= start ? y : y - 1) + 57;
  return `${bs}-${String((bs + 1) % 100).padStart(2, "0")}`;
}

/** INV-2083-84-0001 (or CN-… for a credit note). */
export const taxNumber = (fy: string, no: number, kind = "subscription") => `${kind === "credit" ? "CN" : "INV"}-${fy}-${String(no).padStart(4, "0")}`;

/** The next number of a fiscal year, raised atomically inside the caller's transaction. */
export async function nextTaxNumber(tx: Tx, fy: string): Promise<number> {
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO doc_counters (tenant_id, key, last) VALUES (${PLATFORM_TENANT}, ${`INV:${fy}`}, 1)
    ON CONFLICT (tenant_id, key) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`;
  return Number(rows[0]!.last);
}

const rupees = (paisa: number) => Math.round(paisa / 100);

/** Stores the invoice of a quote (open, unnumbered). The checkout charges exactly this: a later price change cannot alter it. */
export async function createInvoiceFromQuote(tx: Tx, o: { tenantId: string; quote: Quote; by: string | null; billedTo: object; couponId?: string | null; catalogVersion: number }) {
  const q = o.quote;
  if (q.errors.length) throw new Error(`The quote has errors: ${q.errors.map((e) => e.en).join(" ")}`);
  const periodStart = q.lines.find((l) => l.periodStart)?.periodStart ?? null;
  const periodEnd = q.lines.reduce<Date | null>((m, l) => (l.periodEnd && (!m || l.periodEnd > m) ? l.periodEnd : m), null);
  return tx.invoice.create({
    data: {
      tenantId: o.tenantId, planId: null, months: q.lines.find((l) => l.periodMonths)?.periodMonths ?? 1, kind: "subscription",
      subtotal: rupees(q.subtotalPaisa), vat: rupees(q.vatPaisa), total: rupees(q.totalPaisa),
      subtotalPaisa: BigInt(q.subtotalPaisa), vatPaisa: BigInt(q.vatPaisa), totalPaisa: BigInt(q.totalPaisa),
      status: "open", billedTo: o.billedTo as Prisma.InputJsonValue, periodStart, periodEnd, dueAt: q.dueAt, createdBy: o.by,
      couponId: o.couponId ?? null, catalogVersion: o.catalogVersion,
      lines: {
        create: q.lines.map((l, i) => ({
          kind: l.kind, appId: l.appId, editionId: l.editionId, sort: i, qty: l.qty,
          // What the line does when paid is kept with its words (sale type, months, add-on key).
          description: { ...l.description, saleType: l.saleType, periodMonths: l.periodMonths, addonKey: l.addonKey ?? null } as Prisma.InputJsonValue,
          periodStart: l.periodStart, periodEnd: l.periodEnd,
          unitGrossPaisa: BigInt(l.unitGrossPaisa), discountPaisa: BigInt(l.discountPaisa), grossPaisa: BigInt(l.grossPaisa), netPaisa: BigInt(l.netPaisa), vatPaisa: BigInt(l.vatPaisa),
        })),
      },
    },
    include: { lines: true },
  });
}

// ───────────── Revenue ─────────────

/** The app-sales split (platform.revenueShare.appSales): Sheetal's commission % of a sale without VAT, per app or the default. */
export type AppSalesShare = RevenueShare["appSales"];

export interface LineAmounts { id: string; appId: string | null; editionId: string | null; kind: string; saleType: string; grossPaisa: number; vatPaisa: number; netPaisa: number }

/** The revenue rows of a paid invoice: one per line, every split adding back. Pure. */
export function revenueRows(o: { lines: LineAmounts[]; appSales: AppSalesShare; share: RevenueShare; day: string }) {
  return o.lines.map((l) => {
    const pct = (l.appId && Object.hasOwn(o.appSales.perApp, l.appId) ? o.appSales.perApp[l.appId]! : o.appSales.commissionPct);
    const commissionPaisa = pctOf(l.netPaisa, pct);
    const partnerPaisa = partnerShareOf(o.share, { commissionPaisa, appId: l.appId, day: o.day });
    return {
      invoiceLineId: l.id, appId: l.appId, editionId: l.editionId, saleType: l.saleType,
      grossPaisa: l.grossPaisa, vatPaisa: l.vatPaisa, netPaisa: l.netPaisa,
      commissionBp: Math.round(pct * 100), commissionPaisa, partnerBp: partnerPaisa ? Math.round(o.share.technologyPartner.sharePct * 100) : 0,
      partnerPaisa, sheetalNetPaisa: commissionPaisa - partnerPaisa, publisherPaisa: l.netPaisa - commissionPaisa,
    };
  });
}

const SALE_TYPES = new Set(["new", "renewal", "upgrade", "addon", "ai"]);
const nepalDay = (d: Date) => new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);

// ───────────── Applying a paid subscription invoice ─────────────

export interface ApplyResult { applied: boolean; number: string | null; invoiceId: string; tenantId: string }

/**
 * Marks the payment and its invoice paid, gives the tax invoice number, updates the subscriptions and add-ons the lines name, writes the
 * revenue rows, the coupon use, the history, the audit row and the event. Runs inside the caller's transaction. Safe to repeat.
 */
export async function applySubscriptionPayment(tx: Tx, o: {
  paymentId: string; now: Date; providerRef?: string | null; raw?: unknown; reviewedBy?: string | null;
  appSales: AppSalesShare; share: RevenueShare; seller: object;
  publish?: (tx: Tx, name: string, payload: Record<string, unknown>, tenantId: string) => Promise<void>;
}): Promise<ApplyResult> {
  const publish = o.publish ?? publishPlatformEvent;
  const p0 = await tx.payment.findUniqueOrThrow({ where: { id: o.paymentId } });
  // One payer, one apply: hold the invoice row until this transaction ends.
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${p0.invoiceId} FOR UPDATE`;
  const p = await tx.payment.findUniqueOrThrow({ where: { id: o.paymentId }, include: { invoice: { include: { lines: { orderBy: { sort: "asc" } } } } } });
  const inv = p.invoice;
  if (p.status === "paid" || inv.status === "paid") return { applied: false, number: inv.no && inv.fy ? taxNumber(inv.fy, inv.no, inv.kind) : null, invoiceId: inv.id, tenantId: inv.tenantId };
  if (inv.status === "void") throw new Error("This invoice was cancelled.");
  if (inv.kind !== "subscription") throw new Error("Only subscription invoices are applied here.");
  // MB 4: the amount in paisa must equal the invoice total in paisa before anything is marked paid.
  if (p.amountPaisa == null || inv.totalPaisa == null || p.amountPaisa !== inv.totalPaisa) throw new Error("The amount paid doesn't match the invoice.");

  const total = Number(inv.totalPaisa);
  const fy = fiscalYear(o.now);
  const no = total > 0 ? await nextTaxNumber(tx, fy) : null;
  await tx.payment.update({ where: { id: p.id }, data: { status: "paid", paidAt: o.now, providerRef: o.providerRef ?? p.providerRef, raw: (o.raw ?? p.raw ?? undefined) as Prisma.InputJsonValue | undefined, reviewedBy: o.reviewedBy ?? p.reviewedBy } });
  await tx.invoice.update({ where: { id: inv.id }, data: { status: "paid", paidAt: o.now, ...(no ? { no, fy, issuedAt: o.now, sellerSnapshot: o.seller as Prisma.InputJsonValue } : {}) } });

  // Subscriptions and add-ons.
  for (const l of inv.lines) {
    const d = (l.description ?? {}) as { saleType?: string; periodMonths?: number | null; addonKey?: string | null };
    if (l.kind === "subscription" && l.appId && l.editionId) {
      const before = await tx.subscription.findUnique({ where: { tenantId_appId: { tenantId: inv.tenantId, appId: l.appId } } });
      const data = {
        editionId: l.editionId, status: "active", periodMonths: d.periodMonths ?? 1, priceGrossPaisa: l.unitGrossPaisa, listPriceGrossPaisa: l.unitGrossPaisa,
        currentPeriodStart: d.saleType === "renewal" ? l.periodStart : before?.currentPeriodStart && d.saleType === "upgrade" && (d.periodMonths ?? 1) === before.periodMonths ? before.currentPeriodStart : l.periodStart,
        currentPeriodEnd: l.periodEnd, trialEndsAt: null, graceUntil: null, readOnlyFrom: null, cancelAtPeriodEnd: false, cancelledAt: null, uninstalledAt: null, source: "purchase",
        // A waiting downgrade or period switch took effect with this payment.
        pendingEditionId: null, pendingPeriodMonths: null,
      };
      const sub = before
        ? await tx.subscription.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.subscription.create({ data: { ...data, tenantId: inv.tenantId, appId: l.appId } });
      await tx.subscriptionEvent.create({ data: {
        subscriptionId: sub.id, tenantId: inv.tenantId, appId: l.appId, type: d.saleType === "renewal" ? "renewed" : d.saleType === "upgrade" ? "upgraded" : "purchased",
        fromStatus: before?.status ?? null, toStatus: "active", fromEdition: before?.editionId ?? null, toEdition: l.editionId, amountPaisa: l.grossPaisa, invoiceId: inv.id,
        actorKind: o.reviewedBy ? "staff" : "user", actorId: o.reviewedBy ?? p.userId ?? null, at: o.now,
      } });
    } else if (l.kind === "addon" && d.addonKey && l.periodEnd) {
      const key = { tenantId: inv.tenantId, appId: l.appId ?? "", addonKey: d.addonKey };
      const have = await tx.addonSubscription.findUnique({ where: { tenantId_appId_addonKey: key } });
      if (have) await tx.addonSubscription.update({ where: { id: have.id }, data: { qty: have.qty + l.qty, renewQty: have.renewQty + l.qty, currentPeriodEnd: l.periodEnd, unitPriceGrossPaisa: l.unitGrossPaisa } });
      else await tx.addonSubscription.create({ data: { ...key, qty: l.qty, renewQty: l.qty, unitPriceGrossPaisa: l.unitGrossPaisa, periodMonths: d.periodMonths ?? 1, currentPeriodEnd: l.periodEnd } });
    }
  }

  // Revenue: live money only.
  if (p.mode === "live" && inv.lines.length) {
    const rows = revenueRows({
      appSales: o.appSales, share: o.share, day: nepalDay(o.now),
      lines: inv.lines.map((l) => {
        const t = ((l.description ?? {}) as { saleType?: string }).saleType;
        return { id: l.id, appId: l.appId, editionId: l.editionId, kind: l.kind, saleType: t && SALE_TYPES.has(t) ? t : "new", grossPaisa: Number(l.grossPaisa), vatPaisa: Number(l.vatPaisa), netPaisa: Number(l.netPaisa) };
      }),
    });
    await tx.revenueEntry.createMany({ data: rows.map((r) => ({
      ...r, paymentId: p.id, invoiceId: inv.id, tenantId: inv.tenantId, kind: "sale", method: p.provider, mode: "live", catalogVersion: inv.catalogVersion, paidAt: o.now,
      grossPaisa: BigInt(r.grossPaisa), vatPaisa: BigInt(r.vatPaisa), netPaisa: BigInt(r.netPaisa), commissionPaisa: BigInt(r.commissionPaisa), partnerPaisa: BigInt(r.partnerPaisa),
      sheetalNetPaisa: BigInt(r.sheetalNetPaisa), publisherPaisa: BigInt(r.publisherPaisa),
    })) });
  }
  if (inv.couponId) {
    const off = inv.lines.reduce((a, l) => a + Number(l.discountPaisa), 0);
    await tx.couponRedemption.create({ data: { couponId: inv.couponId, tenantId: inv.tenantId, userId: p.userId ?? o.reviewedBy ?? "system", invoiceId: inv.id, discountPaisa: BigInt(off) } });
  }
  const number = no ? taxNumber(fy, no) : null;
  await tx.auditLog.create({ data: { actorId: o.reviewedBy ?? p.userId ?? null, tenantId: inv.tenantId, action: "billing.subscription_paid", target: `${number ?? "no tax invoice (zero total)"} · ${p.provider} · Rs. ${(total / 100).toFixed(2)}` } });
  await publish(tx, "platform.invoice.issued", { invoiceId: inv.id, tenantId: inv.tenantId, number: number ?? "", totalPaisa: total }, inv.tenantId);
  return { applied: true, number, invoiceId: inv.id, tenantId: inv.tenantId };
}

/** One outbox row for a platform event (declared in platform.manifest.ts), written in the same transaction as the change it reports. */
export async function publishPlatformEvent(tx: Tx, name: string, payload: Record<string, unknown>, tenantId: string): Promise<void> {
  await tx.eventOutbox.create({ data: {
    id: randomUUID(), name, v: 1, payload: payload as Prisma.InputJsonValue, tenantId, branchId: null,
    actor: { kind: "system", job: "billing" } as Prisma.InputJsonValue, requestId: `billing-${randomUUID()}`,
  } });
}

// ───────────── Credit notes ─────────────

/**
 * A full credit note for a paid subscription invoice (refunds, P3-BE-7): a new invoice of kind "credit" with the lines negated, its own number,
 * and one "refund" revenue row per original row with the ORIGINAL percentages. Refusing a second credit note for the same invoice is the
 * revenue table's unique key (payment, line, kind). Runs inside the caller's transaction.
 */
export async function issueCreditNote(tx: Tx, o: { invoiceId: string; now: Date; by: string; reason: string }) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: o.invoiceId }, include: { lines: true } });
  if (inv.kind !== "subscription" || inv.status !== "paid" || inv.totalPaisa == null) throw new Error("Only a paid subscription invoice can be credited.");
  if (await tx.invoice.findFirst({ where: { kind: "credit", creditForId: inv.id }, select: { id: true } })) throw new Error("This invoice already has a credit note.");
  const fy = fiscalYear(o.now);
  const no = await nextTaxNumber(tx, fy);
  const neg = (b: bigint | null) => -(b ?? 0n);
  const credit = await tx.invoice.create({
    data: {
      tenantId: inv.tenantId, planId: null, months: inv.months, kind: "credit", creditForId: inv.id, status: "paid", paidAt: o.now,
      subtotal: -inv.subtotal, vat: -inv.vat, total: -inv.total, subtotalPaisa: neg(inv.subtotalPaisa), vatPaisa: neg(inv.vatPaisa), totalPaisa: neg(inv.totalPaisa),
      billedTo: inv.billedTo as Prisma.InputJsonValue, sellerSnapshot: (inv.sellerSnapshot ?? {}) as Prisma.InputJsonValue, dueAt: o.now, createdBy: o.by,
      no, fy, issuedAt: o.now, catalogVersion: inv.catalogVersion,
      lines: { create: inv.lines.map((l) => ({
        kind: l.kind, appId: l.appId, editionId: l.editionId, subscriptionId: l.subscriptionId, description: l.description as Prisma.InputJsonValue, sort: l.sort, qty: l.qty,
        periodStart: l.periodStart, periodEnd: l.periodEnd, unitGrossPaisa: -l.unitGrossPaisa, discountPaisa: -l.discountPaisa, grossPaisa: -l.grossPaisa, netPaisa: -l.netPaisa, vatPaisa: -l.vatPaisa,
      })) },
    },
  });
  const sales = await tx.revenueEntry.findMany({ where: { invoiceId: inv.id, kind: "sale" } });
  if (sales.length) await tx.revenueEntry.createMany({ data: sales.map((r) => ({
    id: randomUUID(), paymentId: r.paymentId, invoiceId: inv.id, invoiceLineId: r.invoiceLineId, tenantId: r.tenantId, appId: r.appId, editionId: r.editionId,
    kind: "refund", saleType: r.saleType, grossPaisa: -r.grossPaisa, vatPaisa: -r.vatPaisa, netPaisa: -r.netPaisa, commissionBp: r.commissionBp, commissionPaisa: -r.commissionPaisa,
    partnerBp: r.partnerBp, partnerPaisa: -r.partnerPaisa, sheetalNetPaisa: -r.sheetalNetPaisa, publisherPaisa: -r.publisherPaisa, method: r.method, mode: r.mode,
    catalogVersion: r.catalogVersion, paidAt: o.now,
  })) });
  await tx.auditLog.create({ data: { actorId: o.by, tenantId: inv.tenantId, action: "billing.credit_note", target: `${taxNumber(fy, no, "credit")} for ${inv.no && inv.fy ? taxNumber(inv.fy, inv.no) : inv.id}`, meta: { reason: o.reason } } });
  return { creditId: credit.id, number: taxNumber(fy, no, "credit") };
}
