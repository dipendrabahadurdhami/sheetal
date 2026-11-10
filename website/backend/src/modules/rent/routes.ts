// Pay rent online (website → Services → Pay rent, and Profile → My rentals).
// Where it fits: PayRent in website/frontend/src/pages/ServicePages.jsx and MyRentals.jsx call these.
// How it works: find a running lease by its property code (ER-0123) or lease code (LS-0007) with the mobile number on
// the lease, or pick one linked to your account; see the bills owed and where to pay (Sheetal Property, or the agency's
// own account); send the payment with its reference and a screenshot. It waits until it is confirmed. See
// backend-core/src/domain/rentpay.ts.
// Rules: nothing about a lease is shown without the right code and number (or the linked account); the screenshot is
// a private file; a payment can't be more than what is still owed and not already waiting.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest } from "@sheetal/backend-core/lib/errors";
import { savePrivateFile } from "@sheetal/backend-core/lib/files";
import { requireUser } from "@sheetal/backend-core/modules/auth/sessions";
import { dayOf, ymd } from "@sheetal/backend-core/domain/money";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { ONLINE_METHODS, findLease, leaseView, takeOnlinePayment } from "@sheetal/backend-core/domain/rentpay";
import { billNo, leaseNo } from "@sheetal/backend-core/domain/rentals";

const strict = (max: number) => ({ config: { rateLimit: { max, timeWindow: "10 minutes" } } });
const Find = z.object({ code: z.string().trim().min(2, "Enter the property code.").max(30), phone: z.string().trim().max(20).nullish() });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");

export async function rentRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const access = async (request: { user?: { id: string } | null }, b: { leaseId?: string | null; code?: string | null; phone?: string | null }) => {
    const userId = request.user?.id ?? null;
    if (b.leaseId && userId) {
      const l = await db().rentLease.findFirst({ where: { id: b.leaseId.slice(0, 40), userId, status: "active" } });
      if (l) return l;
    }
    if (!b.code) throw badRequest("Enter the property code and your mobile number.");
    return findLease(db(), { code: b.code, phone: b.phone, userId });
  };

  app.post("/rent/find", strict(20), async (request) => {
    const b = Find.parse(request.body);
    const l = await access(request, b);
    return { status: 200, data: await leaseView(db(), l.id) };
  });

  // The leases linked to the signed-in person (they link when the person finds one with the right number).
  app.get("/rent/mine", async (request) => {
    const user = requireUser(request);
    const leases = await db().rentLease.findMany({ where: { userId: user.id }, orderBy: [{ status: "asc" }, { startOn: "desc" }], take: 20 });
    const out = [];
    for (const l of leases) {
      const view = l.status === "active" ? await leaseView(db(), l.id) : null;
      const payments = await db().rentPayment.findMany({ where: { bill: { leaseId: l.id }, OR: [{ userId: user.id }, { status: "confirmed" }] }, orderBy: { createdAt: "desc" }, take: 24, include: { bill: { select: { seq: true, month: true } } } });
      out.push({ leaseId: l.id, lease: leaseNo(l.seq), status: l.status, start: ymd(l.startOn), end: ymd(l.endOn), rent: l.rent, view,
        payments: payments.map((p) => ({ id: p.id, bill: billNo(p.bill.seq), month: p.bill.month, amount: p.amount, method: p.method, paidOn: ymd(p.paidOn), status: p.status, note: p.status === "rejected" ? p.reviewNote ?? "" : "" })) });
    }
    return { status: 200, data: out };
  });

  app.post("/rent/pay", { bodyLimit: 12 * 1024 * 1024, ...strict(10) }, async (request) => {
    const b = z.object({
      leaseId: z.string().max(40).nullish(), code: z.string().trim().max(30).nullish(), phone: z.string().trim().max(20).nullish(),
      billId: z.string().min(1).max(40), amount: z.number().int("Use whole rupees.").min(1, "Enter the amount you paid.").max(100_000_000),
      method: z.enum(ONLINE_METHODS), ref: z.string().trim().min(3, "Enter the transaction ID or reference.").max(80), paidOn: Day.optional(),
      proof: z.string().min(16).max(11 * 1024 * 1024).nullish(),
    }).parse(request.body);
    const l = await access(request, b);
    const paidOn = b.paidOn ?? nepalDay();
    if (paidOn > nepalDay()) throw badRequest("The payment date is in the future.");
    const proofFile = b.proof ? await savePrivateFile(app.config.MEDIA_DIR, "proofs", Buffer.from(b.proof, "base64")) : null;
    const p = await takeOnlinePayment(db(), { leaseId: l.id, billId: b.billId, amount: b.amount, method: b.method, ref: b.ref, paidOn, proofFile, userId: request.user?.id ?? null });
    return { status: 200, message: p.collectedBy === "sheetal" ? "Sent. Sheetal Property checks the payment and confirms it, usually within a day." : "Sent. The agency checks the payment and confirms it.", data: p };
  });
}
