// Rent payments for Sheetal staff: rent tenants paid online, to check and confirm or reject.
// Where it fits: the admin panel's Billing → Rent payments tab (LiveBilling.jsx).
// How it works: payments made to Sheetal Property are confirmed here (the money is then recorded for the business's
// payout); staff can also see and confirm payments made to a business's own account. The screenshot opens privately.
// Rules: billing.view reads; billing.refund confirms and rejects. See backend-core/src/domain/rentpay.ts.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { notFound } from "@sheetal/platform/core/errors";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import { confirmRentPayment, rejectRentPayment } from "@sheetal/app-rentals/backend/rentpay";
import { billNo, leaseNo } from "@sheetal/app-rentals/backend/rentals";
import { staffOf } from "./routes.js";

export async function adminRentPaymentRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const audit = (actorId: string, ip: string, action: string, target: string, tenantId: string) => db().auditLog.create({ data: { actorId, tenantId, action, target, ip } });

  app.get("/admin/rent-payments", async (request) => {
    staffOf(request, "platform.billing.read");
    const q = z.object({ status: z.enum(["pending", "confirmed", "rejected", "all"]).default("pending"), to: z.enum(["sheetal", "business", "all"]).default("sheetal") }).parse(request.query);
    const rows = await db().rentPayment.findMany({
      where: { source: "online", deletedAt: null, ...(q.status === "all" ? {} : { status: q.status }), ...(q.to === "all" ? {} : { collectedBy: q.to }) },
      orderBy: { createdAt: "desc" }, take: 300,
      include: { bill: { include: { lease: { include: { unit: { select: { property: true, name: true } } } } } } },
    });
    const tenants = new Map((await db().tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    return {
      data: rows.map((p) => ({
        id: p.id, status: p.status, to: p.collectedBy, tenant: tenants.get(p.tenantId) ?? "", bill: billNo(p.bill.seq), month: p.bill.month, lease: leaseNo(p.bill.lease.seq),
        renter: p.bill.lease.renter, unit: `${p.bill.lease.unit.property} · ${p.bill.lease.unit.name}`, amount: p.amount, method: p.method, ref: p.ref ?? "",
        paidOn: p.paidOn.toISOString().slice(0, 10), sent: p.createdAt.toISOString(), hasProof: !!p.proofFile, note: p.reviewNote ?? "",
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/admin/rent-payments/:id/proof", async (request) => {
    staffOf(request, "platform.billing.read");
    const p = await db().rentPayment.findFirst({ where: { id: request.params.id.slice(0, 40), deletedAt: null }, select: { proofFile: true } });
    const f = p?.proofFile ? await readPrivateFile(app.config.MEDIA_DIR, "proofs", p.proofFile) : null;
    if (!f) throw notFound("No screenshot was sent with this payment.");
    return { data: { type: f.type, data: f.data.toString("base64") } };
  });

  app.post<{ Params: { id: string } }>("/admin/rent-payments/:id/confirm", async (request) => {
    const s = staffOf(request, "platform.billing.refund");
    const p = await db().rentPayment.findFirst({ where: { id: request.params.id.slice(0, 40), deletedAt: null }, select: { tenantId: true } });
    if (!p) throw notFound("Payment not found.");
    const r = await confirmRentPayment(db(), { paymentId: request.params.id.slice(0, 40), by: s.user.id });
    await audit(s.user.id, request.ip, "rent.payment_confirmed", `${r.bill} Rs. ${r.amount}`, p.tenantId);
    return { message: `Confirmed. Rs. ${r.amount} is added to ${r.bill}.` };
  });

  app.post<{ Params: { id: string } }>("/admin/rent-payments/:id/reject", async (request) => {
    const s = staffOf(request, "platform.billing.refund");
    const b = z.object({ note: z.string().trim().min(3, "Say why, so the tenant knows.").max(300) }).parse(request.body);
    const p = await db().rentPayment.findFirst({ where: { id: request.params.id.slice(0, 40), deletedAt: null }, select: { tenantId: true } });
    if (!p) throw notFound("Payment not found.");
    await rejectRentPayment(db(), { paymentId: request.params.id.slice(0, 40), by: s.user.id, note: b.note });
    await audit(s.user.id, request.ip, "rent.payment_rejected", b.note, p.tenantId);
    return { message: "Rejected. The tenant sees why in My rentals." };
  });
}
