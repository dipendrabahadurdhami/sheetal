// Paying rent online: a tenant finds their lease on the website (by the property code or the lease code, with the mobile number on the lease, or from their own account), pays,
// and sends the reference and a screenshot. The payment waits until whoever received the money confirms it.
// Where it fits: moved here from backend-core/src/domain/rentpay.ts (P2-W1-S1); that file re-exports everything. The website API (website/backend/src/modules/rent) finds leases and
// takes payments; the admin API (rent-payments) confirms or rejects the ones paid to Sheetal with confirmRentPayment / rejectRentPayment. The BUSINESS side (confirming or rejecting
// a payment made to the business) is the PaymentService of this app, on the kernel: one transaction with the audit line and the event.
// How it works: money goes to Sheetal Property unless the business collects its own payments (Settings → Payments, "own"). Sheetal staff confirm payments made to Sheetal; the business's
// team (rentals.rental.update) confirms payments made to the business; a super admin can confirm either. Confirming adds the payment to the bill; for money Sheetal collected it is also
// recorded for the business's payout (recordCollected, source "rent").
// Rules: a pending payment doesn't count until it is confirmed; the same payment is never confirmed twice; nothing about a lease is shown unless the code and the mobile number match, or the
// lease is linked to the signed-in person. These functions have no request context (the website and admin APIs are not on the kernel yet, wave 6), so they use the database directly; every
// change they make to a bill, payment or lease also bumps `version`, so the kernel's 409 check sees it.

import { badRequest, notFound } from "@sheetal/platform/core/errors";
import type { Db } from "@sheetal/platform/db/client";
import { notify, notifyStaff, teamWith } from "@sheetal/platform/notify/index";
import { recordCollected } from "@sheetal/backend-core/domain/payouts";
import { ymd } from "@sheetal/backend-core/domain/money";
import { balanceOf, billNo, leaseNo } from "./rentals.js";

export const ONLINE_METHODS = ["fonepay", "esewa", "khalti", "bank", "other"] as const;
const last8 = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "").slice(-8);

/** Where online rent goes: to Sheetal, unless the business collects its own payments. */
export function payTargetOf(settings: unknown): "sheetal" | "business" {
  return (settings as { payments?: { mode?: string } } | null)?.payments?.mode === "own" ? "business" : "sheetal";
}

export interface PayMethod { method: string; label: string; detail: string; qr: string | null }
const SHEETAL: PayMethod[] = [
  { method: "fonepay", label: "Fonepay QR", detail: "Sheetal Property · scan with any banking app", qr: "/pay/fonepay-qr.png" },
  { method: "esewa", label: "eSewa", detail: "Sheetal Property", qr: null },
  { method: "khalti", label: "Khalti", detail: "Sheetal Property", qr: null },
  { method: "bank", label: "Bank transfer", detail: "Sheetal Property · ask us for the account", qr: null },
];
/** The ways to pay: Sheetal's, or the business's own that it switched on (only the public parts, never keys). */
export function payMethodsOf(settings: unknown): PayMethod[] {
  if (payTargetOf(settings) === "sheetal") return SHEETAL;
  const own = ((settings as { payments?: { own?: Record<string, Record<string, unknown>> } } | null)?.payments?.own ?? {});
  const s = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const out: PayMethod[] = [];
  if (own.fonepay?.on) out.push({ method: "fonepay", label: "Fonepay QR", detail: s(own.fonepay.merchant), qr: s(own.fonepay.qr) || null });
  if (own.esewa?.on) out.push({ method: "esewa", label: "eSewa", detail: s(own.esewa.merchant), qr: null });
  if (own.khalti?.on) out.push({ method: "khalti", label: "Khalti", detail: "", qr: null });
  if (own.bankQr?.on) out.push({ method: "bank", label: "Bank transfer", detail: s(own.bankQr.bank), qr: s(own.bankQr.qr) || null });
  return out.length ? out : [{ method: "other", label: "Ask the agency how to pay", detail: "", qr: null }];
}

const NOT_FOUND = "No running lease matches that code and mobile number. Check the code on your lease, or ask your agency.";

/** Finds a running lease by a lease code (LS-0007) or a property code (ER-0123, old codes too). The person must give
 *  the mobile number on the lease, or be the signed-in person the lease is linked to. A signed-in person who gives the
 *  right number gets the lease linked to their account. */
export async function findLease(db: Db, o: { code: string; phone?: string | null; userId?: string | null }) {
  const code = o.code.trim().toUpperCase().replace(/^#/, "").slice(0, 30);
  let leaseId: string | null = null;
  const ls = /^LS-?(\d{1,9})$/.exec(code);
  if (ls) leaseId = (await db.rentLease.findFirst({ where: { seq: Number(ls[1]), status: "active" }, select: { id: true } }))?.id ?? null;
  else if (code) {
    const listing = await db.listing.findFirst({ where: { OR: [{ code }, { oldCodes: { has: code } }] }, select: { id: true } });
    if (listing) leaseId = (await db.rentLease.findFirst({ where: { status: "active", unit: { listingId: listing.id } }, orderBy: { startOn: "desc" }, select: { id: true } }))?.id ?? null;
  }
  if (!leaseId) throw notFound(NOT_FOUND);
  const lease = await db.rentLease.findUniqueOrThrow({ where: { id: leaseId } });
  const mine = !!o.userId && lease.userId === o.userId;
  const phoneOk = !!lease.phone && last8(o.phone).length >= 7 && last8(o.phone) === last8(lease.phone);
  if (!mine && !phoneOk) throw notFound(NOT_FOUND);
  if (o.userId && phoneOk && lease.userId !== o.userId) await db.rentLease.update({ where: { id: lease.id }, data: { userId: o.userId, version: { increment: 1 } } });
  return lease;
}

/** What the tenant sees: the lease, the business, where to pay, and the bills still owed (with what is waiting). */
export async function leaseView(db: Db, leaseId: string) {
  const l = await db.rentLease.findUniqueOrThrow({ where: { id: leaseId }, include: { unit: { select: { property: true, name: true } } } });
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: l.tenantId }, select: { name: true, phone: true, settings: true } });
  const bills = await db.rentBill.findMany({ where: { leaseId: l.id }, orderBy: { month: "asc" }, include: { payments: { where: { status: "pending", deletedAt: null }, select: { amount: true } } } });
  return {
    leaseId: l.id, lease: leaseNo(l.seq), renter: l.renter, unit: `${l.unit.property} · ${l.unit.name}`, rent: l.rent, business: tenant.name, businessPhone: tenant.phone ?? "",
    payTo: payTargetOf(tenant.settings), methods: payMethodsOf(tenant.settings),
    bills: bills.filter((b) => balanceOf(b) > 0).map((b) => {
      const pending = b.payments.reduce((s, p) => s + p.amount, 0);
      return { id: b.id, no: billNo(b.seq), month: b.month, due: ymd(b.dueOn), amount: b.amount, lateFee: b.lateFee, paid: b.paid, balance: balanceOf(b), pending, left: Math.max(0, balanceOf(b) - pending) };
    }),
  };
}

/** Takes an online payment, waiting to be confirmed. The proof is a private file name already saved. */
export async function takeOnlinePayment(db: Db, o: { leaseId: string; billId: string; amount: number; method: string; ref: string; paidOn: string; proofFile: string | null; userId: string | null }) {
  const view = await leaseView(db, o.leaseId);
  const bill = view.bills.find((b) => b.id === o.billId);
  if (!bill) throw badRequest("That bill is already paid, or isn't on this lease.");
  if (o.amount > bill.left) throw badRequest(bill.left ? `That is more than what is owed (Rs. ${bill.left}).` : "A payment for this bill is already waiting to be confirmed.");
  const l = await db.rentLease.findUniqueOrThrow({ where: { id: o.leaseId }, select: { tenantId: true, branchId: true } });
  const collectedBy = view.payTo;
  const p = await db.rentPayment.create({ data: { tenantId: l.tenantId, branchId: l.branchId, billId: bill.id, amount: o.amount, method: o.method, paidOn: new Date(`${o.paidOn}T00:00:00.000Z`), ref: o.ref, status: "pending", source: "online", collectedBy, proofFile: o.proofFile, userId: o.userId } });
  const note = { type: "rent", title: "Rent payment to confirm", message: `${view.renter} paid Rs. ${o.amount} for ${bill.no} (${o.method}, ref ${o.ref}).` };
  if (collectedBy === "sheetal") await notifyStaff(db, "platform.billing.refund", { ...note, message: `${note.message} ${view.business}.`, link: "/admin/billing" }).catch(() => {});
  else await notify(db, await teamWith(db, l.tenantId, ["rentals.rental.read+rentals.rental.create+rentals.rental.update+rentals.rental.delete"], l.branchId), { ...note, link: "/business/rentals/rent", tenantId: l.tenantId }).catch(() => {});
  return { id: p.id, collectedBy, bill: bill.no };
}

/** Confirms a waiting payment: it is added to its bill (only if that doesn't pay more than is owed), and money Sheetal
 *  collected is recorded for the business's payout. */
export async function confirmRentPayment(db: Db, o: { paymentId: string; by: string }) {
  const p = await db.rentPayment.findFirst({ where: { id: o.paymentId, deletedAt: null }, include: { bill: { include: { lease: { include: { unit: { select: { property: true, name: true } } } } } } } });
  if (!p) throw notFound("Payment not found.");
  if (p.status !== "pending") throw badRequest(p.status === "confirmed" ? "This payment is already confirmed." : "This payment was rejected.");
  const b = p.bill;
  await db.$transaction(async (tx) => {
    const took = await tx.rentPayment.updateMany({ where: { id: p.id, status: "pending", deletedAt: null }, data: { status: "confirmed", reviewedBy: o.by, reviewedAt: new Date(), updatedBy: o.by, version: { increment: 1 } } });
    if (!took.count) throw badRequest("Someone already decided on this payment.");
    const added = await tx.rentBill.updateMany({ where: { id: b.id, paid: { lte: b.amount + b.lateFee - p.amount } }, data: { paid: { increment: p.amount }, updatedBy: o.by, version: { increment: 1 } } });
    if (!added.count) throw badRequest("This would pay more than is owed on the bill. Reject it, or ask the tenant.");
  });
  if (p.collectedBy === "sheetal") {
    await recordCollected(db, { tenantId: p.tenantId, branchId: p.branchId, source: "rent", ref: `RP-${p.id}`, what: `Rent ${b.month} · ${leaseNo(b.lease.seq)} · ${b.lease.unit.property} ${b.lease.unit.name}`, gross: p.amount, on: ymd(p.paidOn) });
  }
  return { bill: billNo(b.seq), amount: p.amount };
}

export async function rejectRentPayment(db: Db, o: { paymentId: string; by: string; note: string }) {
  const done = await db.rentPayment.updateMany({ where: { id: o.paymentId, status: "pending", deletedAt: null }, data: { status: "rejected", reviewedBy: o.by, reviewedAt: new Date(), reviewNote: o.note, updatedBy: o.by, version: { increment: 1 } } });
  if (!done.count) throw badRequest("Only a waiting payment can be rejected.");
}
