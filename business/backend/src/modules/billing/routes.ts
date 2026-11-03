import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { isPro } from "@sheetal/backend-core/domain/billing";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { notifyStaff } from "@sheetal/backend-core/lib/notify";
import { AppError, badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { savePrivateFile } from "@sheetal/backend-core/lib/files";
import { esewaCheckout, esewaVerify, fonepayCheckout, fonepayVerify, khaltiCheckout, khaltiVerify, type Fetch, type Verified } from "@sheetal/backend-core/lib/payments";
import { applyPayment, billingSettings, createInvoice, gateways, invoiceNumber, splitVat } from "@sheetal/backend-core/domain/billing";
import { PERIODS, priceFor } from "@sheetal/backend-core/domain/plans";
import { requireUser } from "@sheetal/backend-core/modules/auth/sessions";
import { workspaceOf, type Workspace } from "../access.js";

// A business paying for its plan in /business/billing. The payer goes to eSewa, Khalti or Fonepay and comes back
// to /business/billing/return/<provider>/<payment>, which asks this API to check the result with the gateway;
// only then is the invoice paid and the plan applied. A bank transfer is paid with a proof that Sheetal confirms.

const months = z.coerce.number().int().refine((m) => PERIODS.some((p) => p.months === m), "Choose 1, 3, 6 or 12 months.");

export async function billingRoutes(app: FastifyInstance, opts: { fetch?: Fetch }) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const site = app.config.SITE_URL.replace(/\/$/, "");
  const gw = () => gateways(db(), vault, app.config.NODE_ENV === "production");

  function payer(ws: Workspace) {
    if (!ws.can("billing.manage")) throw forbidden("Only people who manage billing can pay for the plan.");
  }
  const invoiceJson = (i: { id: string; seq: number; createdAt: Date; planId: string; months: number; subtotal: number; vat: number; total: number; status: string; dueAt: Date; paidAt: Date | null; periodStart: Date | null; periodEnd: Date | null; billedTo: unknown }, plans: Map<string, string>) => ({
    id: i.id, number: invoiceNumber(i), plan: plans.get(i.planId) ?? i.planId, planId: i.planId, months: i.months, subtotal: i.subtotal, vat: i.vat, total: i.total, status: i.status,
    issuedAt: i.createdAt, dueAt: i.dueAt, paidAt: i.paidAt, periodStart: i.periodStart, periodEnd: i.periodEnd, billedTo: i.billedTo,
  });

  app.get("/billing", async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("billing.manage") && !ws.can("invoices.view")) throw forbidden("Your role can't see billing.");
    const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, include: { plan: true } });
    const [invoices, plans, g, s, pending] = await Promise.all([
      db().invoice.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, take: 50 }),
      db().plan.findMany({ where: { type: t.type, active: true }, orderBy: { sort: "asc" } }),
      gw(), billingSettings(db()),
      db().payment.findMany({ where: { tenantId: t.id, status: "pending_review" }, select: { id: true, invoiceId: true, amount: true, createdAt: true } }),
    ]);
    const names = new Map((await db().plan.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const coveredBy = t.coveredById ? await db().tenant.findUnique({ where: { id: t.coveredById }, select: { id: true, name: true, renewsAt: true, status: true } }) : null;
    // The owner's own Pro business that could cover this one.
    const canCover = !coveredBy && ws.member.role.perms.includes("*")
      ? ws.user.memberships.find((m) => m.tenantId !== t.id && m.role.perms.includes("*") && !m.tenant.coveredById && isPro(m.tenant.plan) && ["active", "trial", "past_due"].includes(m.tenant.status))?.tenant ?? null : null;
    return {
      data: {
        plan: { id: t.plan.id, name: t.plan.name, price: t.plan.price }, status: t.status, period: t.period, renewsAt: t.renewsAt, graceUntil: t.graceUntil, autoRenew: t.autoRenew,
        invoices: invoices.map((i) => invoiceJson(i, names)), pendingProofs: pending,
        plans: plans.map((p) => ({ id: p.id, name: p.name, price: p.price, periods: PERIODS.map((x) => ({ months: x.months, save: x.save, total: priceFor(p.price, x.months) })) })),
        methods: [g.esewa && { id: "esewa", name: "eSewa", test: g.esewa.mode === "test" }, g.khalti && { id: "khalti", name: "Khalti", test: g.khalti.mode === "test" }, g.fonepay && { id: "fonepay", name: "Fonepay", test: g.fonepay.mode === "test" }, g.manual && { id: "manual", name: "Bank transfer" }].filter(Boolean),
        bank: g.manual ? s.bank : null, vatRate: s.vatRate,
        coveredBy: coveredBy ? { id: coveredBy.id, name: coveredBy.name, renewsAt: coveredBy.renewsAt } : null,
        canCover: canCover ? { id: canCover.id, name: canCover.name } : null,
      },
    };
  });

  app.get<{ Params: { id: string } }>("/billing/invoices/:id", async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("billing.manage") && !ws.can("invoices.view")) throw forbidden("Your role can't see billing.");
    const i = await db().invoice.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId }, include: { payments: { where: { status: { in: ["paid", "refunded"] } }, select: { provider: true, amount: true, paidAt: true, providerRef: true, status: true } } } });
    if (!i) throw notFound("Invoice not found.");
    const names = new Map((await db().plan.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    return { data: { ...invoiceJson(i, names), payments: i.payments, seller: { name: "Sheetal Property", email: app.config.SUPPORT_EMAIL } } };
  });

  /** Starts paying: an invoice (new, or an open one) and a payment attempt with the chosen method. */
  app.post("/billing/checkout", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request) => {
    const ws = workspaceOf(request);
    payer(ws);
    const b = z.object({ provider: z.enum(["esewa", "khalti", "fonepay", "manual"]), invoiceId: z.string().max(40).optional(), planId: z.string().max(40).optional(), months: months.optional() }).parse(request.body);
    const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId } });
    if (t.status === "suspended" || t.status === "cancelled") throw badRequest("This business isn't active. Please contact Sheetal.");
    let invoice;
    if (b.invoiceId) {
      invoice = await db().invoice.findFirst({ where: { id: b.invoiceId, tenantId: t.id } });
      if (!invoice) throw notFound("Invoice not found.");
      if (invoice.status !== "open") throw badRequest(invoice.status === "paid" ? "This invoice is already paid." : "This invoice was cancelled.");
    } else {
      if (!b.planId || !b.months) throw badRequest("Choose a plan and how many months.");
      const plan = await db().plan.findFirst({ where: { id: b.planId, type: t.type, active: true } });
      if (!plan || !plan.price) throw badRequest("Choose a paid plan for this business.");
      // One open invoice per plan and period: reuse it instead of piling up copies.
      invoice = await db().invoice.findFirst({ where: { tenantId: t.id, status: "open", planId: plan.id, months: b.months } })
        ?? await createInvoice(db(), { tenant: t, plan, months: b.months, by: ws.user.id, vatRate: (await billingSettings(db())).vatRate });
    }
    const g = await gw();
    const ref = `SP${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const payment = await db().payment.create({ data: { invoiceId: invoice.id, tenantId: t.id, provider: b.provider, amount: invoice.total, ref, userId: ws.user.id } });
    const back = `${site}/business/billing/return/${b.provider}/${payment.id}`;
    const name = `Sheetal Property ${invoiceNumber(invoice)}`;
    const off = () => { throw new AppError(400, "method_off", "That payment method isn't available right now."); };
    try {
      if (b.provider === "esewa") {
        if (!g.esewa) off();
        return { data: { paymentId: payment.id, invoiceId: invoice.id, ...esewaCheckout({ ...g.esewa!, amount: invoice.total, ref, successUrl: back, failureUrl: `${back}?failed=1` }) } };
      }
      if (b.provider === "khalti") {
        if (!g.khalti) off();
        const c = await khaltiCheckout({ ...g.khalti!, amount: invoice.total, ref, name, returnUrl: back, websiteUrl: site, customer: { name: ws.user.userName, email: ws.user.email, phone: ws.user.phone ?? undefined }, fetch: opts.fetch });
        if (c.method === "redirect" && c.providerRef) await db().payment.update({ where: { id: payment.id }, data: { providerRef: c.providerRef } });
        return { data: { paymentId: payment.id, invoiceId: invoice.id, ...c } };
      }
      if (b.provider === "fonepay") {
        if (!g.fonepay) off();
        return { data: { paymentId: payment.id, invoiceId: invoice.id, ...fonepayCheckout({ ...g.fonepay!, amount: invoice.total, ref, returnUrl: back, remarks: name }) } };
      }
      if (!g.manual) off();
      const s = await billingSettings(db());
      return { data: { paymentId: payment.id, invoiceId: invoice.id, method: "manual", amount: invoice.total, reference: ref, bank: s.bank } };
    } catch (e) {
      await db().payment.update({ where: { id: payment.id }, data: { status: "failed", note: e instanceof Error ? e.message.slice(0, 300) : "failed" } });
      throw e;
    }
  });

  /** The payer is back from the gateway: check the result with the gateway, then apply it. */
  app.post<{ Params: { id: string } }>("/billing/payments/:id/verify", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (request) => {
    // The payer comes back on a fresh page: any business of theirs may be open, so check membership of the payment's own.
    const user = requireUser(request);
    const p = await db().payment.findFirst({ where: { id: request.params.id, tenantId: { in: user.memberships.filter((m) => m.status === "active").map((m) => m.tenantId) } }, include: { invoice: true } });
    if (!p) throw notFound("Payment not found.");
    if (p.status === "paid") return { message: "Paid. Thank you!", data: { status: "paid", tenantId: p.tenantId } };
    const b = z.object({ data: z.string().max(5000).optional(), pidx: z.string().max(100).optional(), query: z.record(z.string(), z.string().max(500)).optional(), failed: z.boolean().optional() }).parse(request.body ?? {});
    if (b.failed) {
      await db().payment.update({ where: { id: p.id }, data: { status: "failed", note: "Cancelled or failed at the gateway" } });
      return { message: "The payment didn't go through. You can try again.", data: { status: "failed" } };
    }
    const g = await gw();
    let v: Verified;
    if (p.provider === "esewa" && g.esewa && b.data) v = await esewaVerify({ ...g.esewa, data: b.data, ref: p.ref, amount: p.amount, fetch: opts.fetch });
    else if (p.provider === "khalti" && g.khalti) {
      const pidx = p.providerRef ?? b.pidx;
      if (!pidx || (b.pidx && b.pidx !== p.providerRef)) throw badRequest("This Khalti answer is for another payment.");
      v = await khaltiVerify({ ...g.khalti, pidx, amount: p.amount, fetch: opts.fetch });
    } else if (p.provider === "fonepay" && g.fonepay && b.query) v = await fonepayVerify({ ...g.fonepay, q: b.query, ref: p.ref, amount: p.amount, fetch: opts.fetch });
    else throw badRequest("Nothing to check for this payment.");
    if (!v.ok) {
      await db().payment.update({ where: { id: p.id }, data: { status: "failed", note: v.reason, raw: (v.raw ?? undefined) as object | undefined } });
      return { message: `${v.reason} You haven't been charged twice; try again or use another method.`, data: { status: "failed" } };
    }
    await applyPayment(db(), app.mailer, { paymentId: p.id, providerRef: v.providerRef, raw: v.raw, siteUrl: site });
    return { message: "Paid. Thank you! Your plan is active.", data: { status: "paid", tenantId: p.tenantId } };
  });

  /** Bank transfer: the proof goes to Sheetal, who confirms it in the admin panel. */
  app.post<{ Params: { id: string } }>("/billing/payments/:id/proof", { bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    payer(ws);
    const p = await db().payment.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, provider: "manual" }, include: { invoice: true } });
    if (!p) throw notFound("Payment not found.");
    if (p.status !== "initiated") throw badRequest("A proof was already sent for this payment.");
    const b = z.object({ data: z.string().min(16).max(11 * 1024 * 1024), reference: z.string().trim().max(80).optional() }).parse(request.body);
    const proofFile = await savePrivateFile(app.config.MEDIA_DIR, "proofs", Buffer.from(b.data, "base64"));
    await db().payment.update({ where: { id: p.id }, data: { status: "pending_review", proofFile, providerRef: b.reference || null } });
    await app.mailer.send({ to: app.config.SUPPORT_EMAIL, subject: `Bank transfer to check: ${invoiceNumber(p.invoice)} (Rs. ${p.amount.toLocaleString("en-IN")})`, text: `${ws.member.tenant.name} sent a bank transfer proof for ${invoiceNumber(p.invoice)}${b.reference ? `, reference ${b.reference}` : ""}.\nConfirm it in the admin panel: Billing → Payments.` });
    await notifyStaff(db(), "billing.view", { type: "billing", title: `Bank transfer to check: ${invoiceNumber(p.invoice)}`, message: `${ws.member.tenant.name} · Rs. ${p.amount.toLocaleString("en-IN")}`, link: "/admin/billing" });
    return { message: "Proof sent. Sheetal confirms bank transfers within a working day; your plan starts then." };
  });

  /** What one price would be split into, for showing VAT before paying. */
  app.get("/billing/quote", async (request) => {
    const ws = workspaceOf(request);
    const q = z.object({ planId: z.string().max(40), months }).parse(request.query);
    const plan = await db().plan.findFirst({ where: { id: q.planId, type: ws.member.tenant.type, active: true } });
    if (!plan) throw notFound("Plan not found.");
    return { data: splitVat(priceFor(plan.price, q.months), (await billingSettings(db())).vatRate) };
  });
}
