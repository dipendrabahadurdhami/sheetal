// Billing for Sheetal staff: payments, invoices, revenue, gateway keys and billing settings, plus the renewal job.
// Where it fits: the admin panel's Billing pages.
// How it works: staff confirm or reject bank transfers (the business is told), record refunds, and set VAT, grace
// period, reminders and bank details. startBillingJob() runs the renewal cycle every 6 hours.
// Rules: gateway keys are write-only: once saved they are never shown again.

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, notFound } from "@sheetal/backend-core/lib/errors";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import { notify } from "@sheetal/backend-core/lib/notify";
import { applyPayment, billingSettings, createInvoice, invoiceNumber, runBillingCycle, type StoredGateways } from "@sheetal/backend-core/domain/billing";
import { PERIODS } from "@sheetal/backend-core/domain/plans";
import { staffOf } from "./routes.js";

export async function adminBillingRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const site = app.config.SITE_URL;
  const audit = (actorId: string, ip: string, action: string, target: string, tenantId?: string, meta?: object) =>
    db().auditLog.create({ data: { actorId, tenantId, action, target, ip, meta: meta as object | undefined } });

  app.get("/admin/billing/summary", async (request) => {
    staffOf(request, "billing.view");
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [month, last30, byProvider, active, pastDue, toCheck] = await Promise.all([
      db().payment.aggregate({ where: { status: "paid", paidAt: { gte: monthStart } }, _sum: { amount: true }, _count: true }),
      db().payment.aggregate({ where: { status: "paid", paidAt: { gte: new Date(now.getTime() - 30 * 864e5) } }, _sum: { amount: true } }),
      db().payment.groupBy({ by: ["provider"], where: { status: "paid", paidAt: { gte: new Date(now.getTime() - 365 * 864e5) } }, _sum: { amount: true }, _count: true }),
      db().tenant.findMany({ where: { status: { in: ["active", "past_due"] }, plan: { price: { gt: 0 } } }, select: { plan: { select: { price: true } } } }),
      db().tenant.count({ where: { status: "past_due" } }),
      db().payment.count({ where: { status: "pending_review" } }),
    ]);
    return {
      data: {
        thisMonth: month._sum.amount ?? 0, paymentsThisMonth: month._count, last30Days: last30._sum.amount ?? 0,
        // Monthly recurring: what paying businesses' plans are worth a month at list price.
        mrr: active.reduce((s, t) => s + t.plan.price, 0), payingBusinesses: active.length, pastDue, toCheck,
        byProvider: byProvider.map((p) => ({ provider: p.provider, total: p._sum.amount ?? 0, count: p._count })),
      },
    };
  });

  app.get("/admin/billing/payments", async (request) => {
    staffOf(request, "billing.view");
    const q = z.object({ status: z.enum(["all", "pending_review", "paid", "failed", "refunded", "initiated"]).default("all") }).parse(request.query);
    const rows = await db().payment.findMany({ where: q.status === "all" ? { status: { not: "initiated" } } : { status: q.status }, include: { invoice: true }, orderBy: { createdAt: "desc" }, take: 300 });
    const tenants = new Map((await db().tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true, type: true } })).map((t) => [t.id, t]));
    return {
      data: rows.map(({ raw: _raw, proofFile, invoice, ...p }) => ({
        ...p, invoice: { id: invoice.id, number: invoiceNumber(invoice), planId: invoice.planId, months: invoice.months, status: invoice.status },
        tenant: tenants.get(p.tenantId) ?? null, proof: proofFile ? `/admin/billing/payments/${p.id}/proof` : null,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/admin/billing/payments/:id/proof", async (request, reply) => {
    staffOf(request, "billing.view");
    const p = await db().payment.findUnique({ where: { id: request.params.id } });
    const f = p?.proofFile ? await readPrivateFile(app.config.MEDIA_DIR, "proofs", p.proofFile) : null;
    if (!p || !f) throw notFound("Proof not found.");
    return reply.header("content-type", f.type).header("cache-control", "private, no-store").send(f.data);
  });

  /** A bank transfer checked against the bank statement: confirm (applies the plan) or reject with a reason. */
  app.post<{ Params: { id: string } }>("/admin/billing/payments/:id/review", async (request) => {
    const s = staffOf(request, "plans.manage");
    const b = z.object({ decision: z.enum(["confirm", "reject"]), note: z.string().trim().max(300).optional() }).parse(request.body);
    const p = await db().payment.findUnique({ where: { id: request.params.id }, include: { invoice: true } });
    if (!p) throw notFound("Payment not found.");
    if (p.status !== "pending_review") throw badRequest("This payment isn't waiting to be checked.");
    if (b.decision === "reject") {
      if (!b.note) throw badRequest("Say why, so the business can fix it.");
      await db().payment.update({ where: { id: p.id }, data: { status: "failed", note: b.note, reviewedBy: s.user.id } });
      await audit(s.user.id, request.ip, "billing.transfer_rejected", invoiceNumber(p.invoice), p.tenantId, { note: b.note });
      const owner = await db().membership.findFirst({ where: { tenantId: p.tenantId, role: { key: "owner" }, status: "active" }, select: { user: { select: { id: true, email: true } } } });
      if (owner) {
        await app.mailer.send({ to: owner.user.email, subject: `Bank transfer not confirmed: ${invoiceNumber(p.invoice)}`, text: `We couldn't confirm the bank transfer for ${invoiceNumber(p.invoice)}: ${b.note}\n\nPay again from your business panel, or reply to this email.\n${site.replace(/\/$/, "")}/business/billing\n\nSheetal Property` });
        await notify(db(), [owner.user.id], { tenantId: p.tenantId, type: "billing", title: "Bank transfer not confirmed", message: b.note, link: "/business/billing" });
      }
      return { message: "Rejected; the business has been told." };
    }
    await applyPayment(db(), app.mailer, { paymentId: p.id, reviewedBy: s.user.id, siteUrl: site });
    return { message: "Confirmed. The plan is active." };
  });

  /** Money given back through the gateway's or bank's own portal; this records it. The plan is changed separately. */
  app.post<{ Params: { id: string } }>("/admin/billing/payments/:id/refund", async (request) => {
    const s = staffOf(request, "billing.refund");
    const { note } = z.object({ note: z.string().trim().min(3, "Say why.").max(300) }).parse(request.body);
    const p = await db().payment.findUnique({ where: { id: request.params.id }, include: { invoice: true } });
    if (!p || p.status !== "paid") throw badRequest("Only paid payments can be refunded.");
    await db().payment.update({ where: { id: p.id }, data: { status: "refunded", note } });
    await audit(s.user.id, request.ip, "billing.refunded", `${invoiceNumber(p.invoice)} · Rs. ${p.amount}`, p.tenantId, { note });
    return { message: "Marked as refunded. Change the business's plan if it should end now." };
  });

  app.get("/admin/billing/invoices", async (request) => {
    staffOf(request, "billing.view");
    const q = z.object({ status: z.enum(["all", "open", "paid", "void"]).default("all"), tenantId: z.string().max(40).optional() }).parse(request.query);
    const where: Prisma.InvoiceWhereInput = { ...(q.status !== "all" ? { status: q.status } : {}), ...(q.tenantId ? { tenantId: q.tenantId } : {}) };
    const rows = await db().invoice.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 });
    const tenants = new Map((await db().tenant.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    return { data: rows.map((i) => ({ ...i, number: invoiceNumber(i), tenant: tenants.get(i.tenantId) ?? null })) };
  });

  /** Staff bill a business directly (a plan sold by phone, say); the business pays it from its panel. */
  app.post("/admin/billing/invoices", async (request) => {
    const s = staffOf(request, "plans.manage");
    const b = z.object({ tenantId: z.string().max(40), planId: z.string().max(40), months: z.number().int().refine((m) => PERIODS.some((p) => p.months === m)) }).parse(request.body);
    const t = await db().tenant.findUnique({ where: { id: b.tenantId } });
    const plan = await db().plan.findUnique({ where: { id: b.planId } });
    if (!t || !plan || plan.type !== t.type || !plan.price) throw badRequest("Choose a paid plan for this business's type.");
    const i = await createInvoice(db(), { tenant: t, plan, months: b.months, by: s.user.id, vatRate: (await billingSettings(db())).vatRate });
    await audit(s.user.id, request.ip, "billing.invoice_created", invoiceNumber(i), t.id);
    return { message: `${invoiceNumber(i)} created. ${t.name} can pay it from their billing page.`, data: { id: i.id } };
  });

  app.post<{ Params: { id: string } }>("/admin/billing/invoices/:id/void", async (request) => {
    const s = staffOf(request, "plans.manage");
    const i = await db().invoice.findUnique({ where: { id: request.params.id } });
    if (!i || i.status !== "open") throw badRequest("Only open invoices can be cancelled.");
    await db().invoice.update({ where: { id: i.id }, data: { status: "void" } });
    await audit(s.user.id, request.ip, "billing.invoice_void", invoiceNumber(i), i.tenantId);
    return { message: "Invoice cancelled." };
  });

  // ───── Settings ─────
  app.get("/admin/settings/billing", async (request) => {
    staffOf(request, "settings.platform");
    return { data: await billingSettings(db()) };
  });
  app.put("/admin/settings/billing", async (request) => {
    const s = staffOf(request, "settings.platform");
    const b = z.object({
      vatRate: z.number().min(0).max(30), graceDays: z.number().int().min(0).max(60), reminderDays: z.array(z.number().int().min(1).max(60)).max(5),
      bank: z.object({ name: z.string().max(80).optional(), account: z.string().max(40).optional(), accountName: z.string().max(80).optional(), note: z.string().max(300).optional() }),
    }).parse(request.body);
    await db().appSetting.upsert({ where: { key: "billing" }, create: { key: "billing", value: b }, update: { value: b } });
    await audit(s.user.id, request.ip, "settings.billing", "billing", undefined, { vatRate: b.vatRate, graceDays: b.graceDays });
    return { message: "Billing settings saved." };
  });

  const stored = async () => ((await db().appSetting.findUnique({ where: { key: "payments" } }))?.value ?? {}) as StoredGateways;
  /** Gateway settings without the secrets: only whether one is saved. */
  app.get("/admin/settings/payments", async (request) => {
    staffOf(request, "settings.platform");
    const s = await stored();
    return {
      data: {
        esewa: { enabled: s.esewa?.enabled ?? false, mode: s.esewa?.mode ?? "test", productCode: s.esewa?.productCode ?? "", hasSecret: !!s.esewa?.secretKey },
        khalti: { enabled: s.khalti?.enabled ?? false, mode: s.khalti?.mode ?? "test", hasSecret: !!s.khalti?.secretKey },
        fonepay: { enabled: s.fonepay?.enabled ?? false, mode: s.fonepay?.mode ?? "test", merchantCode: s.fonepay?.merchantCode ?? "", hasSecret: !!s.fonepay?.secretKey },
        manual: { enabled: s.manual?.enabled ?? true },
        testMerchant: app.config.NODE_ENV !== "production",
      },
    };
  });
  /** Saving keeps a secret unless a new one is typed; secrets are encrypted and never sent back. Super admin only. */
  app.put("/admin/settings/payments", async (request) => {
    const s = staffOf(request, "settings.platform");
    if (s.role !== "super_admin") throw badRequest("Only the super admin can change payment keys.");
    const mode = z.enum(["test", "live"]);
    const secret = z.string().trim().min(4).max(500).optional();
    const b = z.object({
      esewa: z.object({ enabled: z.boolean(), mode, productCode: z.string().trim().max(40).optional(), secretKey: secret }),
      khalti: z.object({ enabled: z.boolean(), mode, secretKey: secret }),
      fonepay: z.object({ enabled: z.boolean(), mode, merchantCode: z.string().trim().max(40).optional(), secretKey: secret }),
      manual: z.object({ enabled: z.boolean() }),
    }).parse(request.body);
    const cur = await stored();
    const seal = (v: string | undefined, old?: string) => (v ? vault.seal(v) : old);
    const next: StoredGateways = {
      esewa: { enabled: b.esewa.enabled, mode: b.esewa.mode, productCode: b.esewa.productCode, secretKey: seal(b.esewa.secretKey, cur.esewa?.secretKey) },
      khalti: { enabled: b.khalti.enabled, mode: b.khalti.mode, secretKey: seal(b.khalti.secretKey, cur.khalti?.secretKey) },
      fonepay: { enabled: b.fonepay.enabled, mode: b.fonepay.mode, merchantCode: b.fonepay.merchantCode, secretKey: seal(b.fonepay.secretKey, cur.fonepay?.secretKey) },
      manual: b.manual,
    };
    for (const [k, g] of Object.entries(next) as [string, { enabled: boolean; mode?: string; secretKey?: string; productCode?: string; merchantCode?: string }][]) {
      if (k !== "manual" && g.enabled && !g.secretKey) throw badRequest(`Add the ${k} secret key to switch it on.`);
      if (k === "esewa" && g.enabled && !g.productCode) throw badRequest("Add eSewa's merchant (product) code.");
      if (k === "fonepay" && g.enabled && !g.merchantCode) throw badRequest("Add Fonepay's merchant code.");
    }
    await db().appSetting.upsert({ where: { key: "payments" }, create: { key: "payments", value: next as Prisma.InputJsonValue }, update: { value: next as Prisma.InputJsonValue } });
    await audit(s.user.id, request.ip, "settings.payments", "payment gateways", undefined, { esewa: b.esewa.enabled && b.esewa.mode, khalti: b.khalti.enabled && b.khalti.mode, fonepay: b.fonepay.enabled && b.fonepay.mode, manual: b.manual.enabled });
    return { message: "Payment settings saved." };
  });

  app.post("/admin/billing/run-cycle", async (request) => {
    const s = staffOf(request, "plans.manage");
    const r = await runBillingCycle(db(), app.mailer, { siteUrl: site });
    await audit(s.user.id, request.ip, "billing.cycle_run", `${r.reminded} reminded, ${r.pastDue} past due, ${r.downgraded} to Starter`);
    return { message: `Done: ${r.reminded} reminded, ${r.pastDue} now past due, ${r.downgraded} moved to Starter.`, data: r };
  });
}

/** Runs the renewal cycle every 6 hours (and shortly after start). Only one API process should run it: the admin API. */
export function startBillingJob(app: FastifyInstance) {
  const run = () => runBillingCycle(dbOf(app), app.mailer, { siteUrl: app.config.SITE_URL })
    .then((r) => app.log.info(r, "billing cycle"))
    .catch((e) => app.log.error({ err: e }, "billing cycle failed"));
  const first = setTimeout(run, 30_000);
  const every = setInterval(run, 6 * 3600_000);
  app.addHook("onClose", async () => { clearTimeout(first); clearInterval(every); });
}
