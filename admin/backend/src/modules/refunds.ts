// Admin -> Refunds (MARKETPLACE-AND-BILLING.md section 11; P3-BE-7): staff ask for a refund, a second staff member approves, the credit note is
// issued, and finance records when the money went back.
// Where it fits: registered in admin/backend/src/app.ts under /v1. A request is a PlatformApproval (platform-approvals.ts) with action
// "platform.billing.refund"; approving it runs executeRefund(), which calls issueCreditNote() (platform/src/billing/invoice.ts).
//   GET  /admin/refunds                ?status=pending|done|all   requests with their payment, invoice, business and where the money stands
//   POST /admin/refunds                { paymentId, lineIds?, endAccess, reason }   202 "Sent for approval" (or done at once, see below)
//   POST /admin/refunds/:id/sent       { ref }   the money went back to the payer (bank or wallet reference)
// How it works: the amount is never typed. Without lineIds the whole invoice is refunded; with lineIds only those lines (a part of a bundle).
// Approving runs in ONE transaction: claim the request, lock the payment, check what is left to refund, issue the credit note (its own
// number, refund revenue rows with the original percentages), add to payment.refundedPaisa, and, when asked (a full refund inside the refund
// window), take the app back to its free edition or end it. Afterwards the business owner is told and platform.refund.executed is published.
// When nobody else on the team may approve refunds, the request runs at once and the audit says the second check was skipped.
// Rules: platform.billing.refund to ask, approve and record; platform.billing.read to see. Test payments are never refunded here (they made no
// sale). Nothing is paid out automatically: "sent" is recorded by a person after the bank or wallet transfer.

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { Prisma, PlatformApproval } from "@prisma/client";
import { z } from "zod";
import { dbOf, type Db } from "@sheetal/platform/db/client";
import { badRequest, conflict, notFound } from "@sheetal/platform/core/errors";
import { SettingsService } from "@sheetal/platform/settings/service";
import { BILLING_SETTING, CATALOG_SETTING, withNewApps } from "@sheetal/platform/billing/catalog";
import { issueCreditNote, taxNumber } from "@sheetal/platform/billing/invoice";
import { notify } from "@sheetal/platform/notify/index";
import { staffOf } from "./routes.js";
import { approvalJson, approversFor, claimApproval, markExecuted, registerExecutor, requestApproval } from "./platform-approvals.js";

const QUIET = { warn: () => undefined };
const ACTION = "platform.billing.refund";
const PERM = "platform.billing.refund";
const Ask = z.object({
  paymentId: z.string().min(1).max(40), lineIds: z.array(z.string().min(1).max(40)).max(50).optional(), endAccess: z.boolean().default(false),
  reason: z.string().trim().min(5, "Give a reason of 5 to 300 characters.").max(300),
}).strict();
interface Payload { paymentId: string; invoiceId: string; tenantId: string; lineIds: string[] | null; endAccess: boolean; reason: string; number: string }

/** Everything that must hold to refund (checked when asking and again, under a lock, when approving). */
async function refundable(db: Db | Prisma.TransactionClient, paymentId: string, lineIds: string[] | undefined) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { invoice: { include: { lines: true } } } });
  if (!p) throw notFound("Payment not found.");
  const inv = p.invoice;
  if (p.status !== "paid" || p.amountPaisa == null) throw badRequest("Only a paid app payment can be refunded here.");
  if (p.mode !== "live") throw badRequest("A test payment made no sale, so there is nothing to refund.");
  if (inv.kind !== "subscription" || inv.status !== "paid" || inv.no == null || inv.fy == null) throw badRequest("Only a paid app invoice can be refunded.");
  const lines = lineIds?.length ? inv.lines.filter((l) => lineIds.includes(l.id)) : inv.lines;
  if (lineIds?.length && lines.length !== new Set(lineIds).size) throw badRequest("Choose lines of this invoice.");
  const amount = lineIds?.length ? lines.reduce((a, l) => a + Number(l.grossPaisa), 0) : Number(inv.totalPaisa ?? 0);
  const left = Number(p.amountPaisa) - Number(p.refundedPaisa);
  if (amount <= 0) throw badRequest("There is nothing to refund on these lines.");
  if (amount > left) throw badRequest(`Only Rs ${(left / 100).toFixed(2)} of this payment is left to refund.`);
  const credited = (await db.invoiceLine.findMany({ where: { invoice: { kind: "credit", creditForId: inv.id } }, select: { description: true } }))
    .map((l) => ((l.description ?? {}) as { creditOfLineId?: string }).creditOfLineId ?? "*");
  if (credited.includes("*") || lines.some((l) => credited.includes(l.id))) throw badRequest("Part of this was already refunded: choose lines that were not.");
  const whole = !lineIds?.length || lines.length === inv.lines.length;
  return { p, inv, amount, whole, number: taxNumber(inv.fy, inv.no, inv.kind) };
}

export async function adminRefundRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const store = () => new SettingsService(db(), QUIET);

  /** Runs an approved (or one-person) refund. `checkerId` null = no second approver on the team. */
  async function executeRefund(row: PlatformApproval, checkerId: string | null, note: string, ip: string) {
    const pl = row.payload as unknown as Payload;
    const catalog = withNewApps(await store().get(CATALOG_SETTING));
    const now = new Date();
    const out = await db().$transaction(async (tx) => {
      await claimApproval(tx, row.id, { checkerId, note, now });
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${pl.paymentId} FOR UPDATE`;
      const r = await refundable(tx, pl.paymentId, pl.lineIds ?? undefined);
      const by = checkerId ?? row.makerId;
      const cn = await issueCreditNote(tx, { invoiceId: r.inv.id, now, by, reason: pl.reason, lineIds: pl.lineIds ?? undefined });
      await tx.payment.update({ where: { id: r.p.id }, data: { refundedPaisa: { increment: BigInt(cn.totalPaisa) } } });
      // The apps on the refunded lines (a line names its app; the subscription is the business's one for that app).
      const appIds = [...new Set(r.inv.lines.filter((l) => cn.lineIds.includes(l.id) && l.appId).map((l) => l.appId!))];
      for (const appId of appIds) {
        const s = await tx.subscription.findUnique({ where: { tenantId_appId: { tenantId: r.inv.tenantId, appId } } });
        if (!s) continue;
        let toStatus = s.status, toEdition = s.editionId;
        if (pl.endAccess) {
          const a = catalog.apps[s.appId];
          const free = a?.freeEditionEnabled ? Object.keys(a.editions).find((e) => a.editions[e]!.free) : undefined;
          // Back to the free edition when the app has one, otherwise the paid time ends now.
          const data: Prisma.SubscriptionUpdateInput = free
            ? { editionId: free, status: "active", periodMonths: null, priceGrossPaisa: 0n, currentPeriodEnd: now, cancelAtPeriodEnd: false, pendingEditionId: null, version: { increment: 1 } }
            : { status: "expired", currentPeriodEnd: now, cancelAtPeriodEnd: false, version: { increment: 1 } };
          await tx.subscription.update({ where: { id: s.id }, data });
          toStatus = free ? "active" : "expired"; toEdition = free ?? s.editionId;
        }
        await tx.subscriptionEvent.create({ data: { subscriptionId: s.id, tenantId: s.tenantId, appId: s.appId, type: "refunded", fromStatus: s.status, toStatus, fromEdition: s.editionId, toEdition, amountPaisa: -BigInt(cn.totalPaisa), invoiceId: cn.creditId, actorKind: "staff", actorId: by, reason: pl.reason, at: now } });
      }
      const result = { creditId: cn.creditId, number: cn.number, amountPaisa: cn.totalPaisa, whole: cn.whole, endAccess: pl.endAccess, approvalSkipped: checkerId == null };
      await markExecuted(tx, row.id, now, result);
      await tx.eventOutbox.create({ data: {
        id: randomUUID(), name: "platform.refund.executed", v: 1, payload: { invoiceId: r.inv.id, tenantId: r.inv.tenantId, number: cn.number, amountPaisa: cn.totalPaisa } as Prisma.InputJsonValue,
        tenantId: r.inv.tenantId, branchId: null, actor: { kind: "staff", staffId: by } as Prisma.InputJsonValue, requestId: `refund-${row.id}`,
      } });
      await tx.auditLog.create({ data: { actorId: by, tenantId: r.inv.tenantId, action: "billing.refund_executed", target: `${cn.number} for ${r.number}`, ip, meta: { approvalId: row.id, amountPaisa: cn.totalPaisa, endAccess: pl.endAccess, ...(checkerId == null ? { note: "no second approver on the team: approval skipped" } : {}) } } });
      return result;
    });
    const owner = await db().membership.findFirst({ where: { tenantId: pl.tenantId, status: "active", role: { key: "owner" } }, select: { userId: true } });
    if (owner) await notify(db(), [owner.userId], { tenantId: pl.tenantId, type: "billing", link: "/business/billing", title: "Refund approved", message: `Credit note ${out.number} for Rs ${(out.amountPaisa / 100).toFixed(2)} on invoice ${pl.number}. The money is sent back to you separately.` });
    return out;
  }

  if (app.db) registerExecutor(db(), { action: ACTION, permission: PERM, label: "Refund", run: (row, checker, request, note) => executeRefund(row, checker.user.id, note, request.ip) });

  app.get("/admin/refunds", async (request) => {
    staffOf(request, "platform.billing.read");
    const q = z.object({ status: z.enum(["pending", "done", "all"]).default("all") }).strict().parse(request.query);
    const now = new Date();
    await db().platformApproval.updateMany({ where: { action: ACTION, status: "pending", expiresAt: { lte: now } }, data: { status: "expired", decidedAt: now } });
    const rows = await db().platformApproval.findMany({ where: { action: ACTION, ...(q.status === "pending" ? { status: "pending" } : q.status === "done" ? { status: { not: "pending" } } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    const pls = rows.map((r) => r.payload as unknown as Payload);
    const T = new Map((await db().tenant.findMany({ where: { id: { in: [...new Set(pls.map((x) => x.tenantId))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    return { data: rows.map((r, i) => {
      const res = (r.result ?? {}) as { sentAt?: string; sentRef?: string; number?: string };
      const stage = r.status === "executed" ? (res.sentAt ? "money_sent" : "money_to_send") : r.status;
      return { ...approvalJson(r, "Refund"), business: T.get(pls[i]!.tenantId) ?? null, invoiceNumber: pls[i]!.number, creditNumber: res.number ?? null, stage, sentRef: res.sentRef ?? null, sentAt: res.sentAt ?? null };
    }) };
  });

  app.post("/admin/refunds", async (request, reply) => {
    const s = staffOf(request, PERM);
    const b = Ask.parse(request.body);
    const r = await refundable(db(), b.paymentId, b.lineIds);
    if (b.endAccess) {
      if (!r.whole) throw badRequest("Access can only be ended with a full refund.");
      const days = (await store().get(BILLING_SETTING)).refundWindowDays;
      if (!r.p.paidAt || Date.now() - r.p.paidAt.getTime() > days * 864e5) throw badRequest(`Access can only be ended within ${days} days of the payment.`);
    }
    const open = await db().platformApproval.count({ where: { action: ACTION, resourceId: r.p.id, status: "pending", expiresAt: { gt: new Date() } } });
    if (open) throw conflict("A refund for this payment is already waiting for approval.");
    const payload: Payload = { paymentId: r.p.id, invoiceId: r.inv.id, tenantId: r.inv.tenantId, lineIds: b.lineIds?.length ? b.lineIds : null, endAccess: b.endAccess, reason: b.reason, number: r.number };
    const target = `Rs ${(r.amount / 100).toFixed(2)} on ${r.number}`;
    if ((await approversFor(db(), PERM, s.user.id)).length) {
      const row = await requestApproval(db(), { action: ACTION, resource: "payment", resourceId: r.p.id, payload, amountPaisa: r.amount, maker: s, note: b.reason, now: new Date(), ip: request.ip, target, tenantId: r.inv.tenantId });
      reply.status(202);
      return { message: "Sent for approval. Another staff member who handles refunds must approve it.", code: "approval_needed", data: { approvalId: row.id, amountPaisa: r.amount } };
    }
    // One-person team: the request is stored and run at once; the audit row says the second check was skipped.
    const row = await db().platformApproval.create({ data: {
      action: ACTION, resource: "payment", resourceId: r.p.id, payload: payload as unknown as Prisma.InputJsonValue, amountPaisa: BigInt(r.amount), status: "pending",
      makerId: s.user.id, makerNote: b.reason, expiresAt: new Date(Date.now() + 60_000),
    } });
    const done = await executeRefund(row, null, "no second approver on the team", request.ip);
    return { message: `Refunded: credit note ${done.number}. Now send the money back and record it.`, data: { approvalId: row.id, ...done } };
  });

  app.post<{ Params: { id: string } }>("/admin/refunds/:id/sent", async (request) => {
    const s = staffOf(request, PERM);
    const b = z.object({ ref: z.string().trim().min(3, "Give the bank or wallet reference.").max(120) }).strict().parse(request.body);
    const row = await db().platformApproval.findUnique({ where: { id: request.params.id } });
    if (!row || row.action !== ACTION) throw notFound("Refund not found.");
    if (row.status !== "executed") throw badRequest("Only an approved refund can be marked as sent.");
    const res = (row.result ?? {}) as Record<string, unknown>;
    if (res.sentAt) throw conflict("This refund was already marked as sent.");
    const now = new Date();
    const pl = row.payload as unknown as Payload;
    await db().$transaction([
      db().platformApproval.update({ where: { id: row.id }, data: { result: { ...res, sentRef: b.ref, sentAt: now.toISOString(), sentBy: s.user.id } as Prisma.InputJsonValue } }),
      db().payment.update({ where: { id: pl.paymentId }, data: { refundRef: b.ref, refundSentAt: now } }),
      db().auditLog.create({ data: { actorId: s.user.id, tenantId: pl.tenantId, action: "billing.refund_sent", target: `${String(res.number ?? "")} ref ${b.ref}`, ip: request.ip } }),
    ]);
    return { message: "Recorded: the money was sent back." };
  });
}
