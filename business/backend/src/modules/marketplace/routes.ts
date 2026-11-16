// The business side of the marketplace (MARKETPLACE-AND-BILLING.md sections 5 and 16, P3-BE-6): see the apps, install a free one, start a
// trial, quote and pay a cart, change or cancel a subscription, add-ons, coupons, and the billing overview.
// Where it fits: registered in business/backend/src/app.ts under /v1. Uses the pure core (platform/src/billing: quote, effectiveStatus),
// the invoices (createInvoiceFromQuote, applySubscriptionPayment through applyPayment), the payment router (Sheetal's own system only) and the
// same gateways and return page as today's plan checkout (POST /billing/payments/:id/verify checks app invoices to the paisa).
// How it works: every route needs workspace.billing.manage. GET /marketplace answers in every billing mode; everything that changes a
// subscription needs billingMode "apps" (a business on today's plans gets 409 billing_mode, so this whole file is switched off by the flag).
// The checkout builds the invoice from the SAME quote the cart showed (one function); a later price change cannot alter a stored invoice.
// Rules: one trial per business per app, and not again for the same owner's other business; a coupon once per business; nothing here ever
// deletes data (remove = uninstall, the records stay); bodies are .strict().

import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { AppError, badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import { dbOf, type Db } from "@sheetal/platform/db/client";
import { SettingsService } from "@sheetal/platform/settings/service";
import { Vault } from "@sheetal/platform/auth/vault";
import { BILLING_SETTING, CATALOG_SETTING, publicCatalog, withAiApp, withNewApps } from "@sheetal/platform/billing/catalog";
import { addNepalDays, anchorOf } from "@sheetal/platform/billing/days";
import { effectiveStatus } from "@sheetal/platform/billing/effective-status";
import { applySubscriptionPayment, createInvoiceFromQuote, taxNumber } from "@sheetal/platform/billing/invoice";
import { reconcileListingLimit } from "@sheetal/backend-core/domain/listing-limit";
import { COMPANY_SETTING, sellerSnapshot } from "@sheetal/platform/billing/company";
import { quote } from "@sheetal/platform/billing/quote";
import type { BillingState, CartItem, CouponInput, SubscriptionState, SubscriptionStatus } from "@sheetal/platform/billing/types";
import { loadPaymentConnections, resolvePaymentMethods } from "@sheetal/platform/payments/router";
import { REVENUE_SHARE } from "@sheetal/platform/settings/defs";
import { esewaCheckout, fonepayCheckout, khaltiCheckout, rupeesText, type Fetch } from "@sheetal/backend-core/lib/payments";
import { billingSettings, gateways } from "@sheetal/backend-core/domain/billing";
import { platformSettings } from "@sheetal/backend-core/domain/platform";
import { workspaceOf, type Workspace } from "../access.js";
import { AppId, Cancel, Cart, Change, Checkout, CouponCheck, PayInvoice, Trial } from "./bodies.js";

const n = (v: bigint | number | null | undefined) => (v == null ? 0 : Number(v));
const QUIET = { warn: () => undefined };

export async function marketplaceRoutes(app: FastifyInstance, opts: { fetch?: Fetch } = {}) {
  const db = (): Db => dbOf(app);
  const store = () => new SettingsService(db(), QUIET);
  const site = app.config.SITE_URL.replace(/\/$/, "");
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const env = app.config.NODE_ENV as "development" | "test" | "production";

  /** The caller manages billing for this business; for changes, the business is on per-app billing. */
  async function payer(request: Parameters<typeof workspaceOf>[0], needApps = true) {
    const ws = workspaceOf(request);
    if (!ws.can("workspace.billing.manage")) throw forbidden("Only people who manage billing can change apps and pay Sheetal.");
    const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, include: { billingLock: true } });
    if (needApps && t.billingMode !== "apps") throw new AppError(409, "billing_mode", "Your business is still on its Starter / Business / Pro plan. Apps arrive when Sheetal moves your business.");
    if (needApps && (t.status === "suspended" || t.status === "cancelled")) throw badRequest("This business isn't active. Please contact Sheetal.");
    return { ws, t };
  }
  const settings = async () => {
    const s = store();
    // Sheetal AI plans are sold as a hidden app (P3-FE-6); publicCatalog() leaves hidden apps out, so the cards don't change.
    return { catalog: withAiApp(withNewApps(await s.get(CATALOG_SETTING))), billing: await s.get(BILLING_SETTING) };
  };
  const toState = (s: Awaited<ReturnType<Db["subscription"]["findMany"]>>[number]): SubscriptionState => ({
    appId: s.appId, editionId: s.editionId, status: s.status as SubscriptionStatus, periodMonths: s.periodMonths, priceGrossPaisa: n(s.priceGrossPaisa),
    currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, trialUsedAt: s.trialUsedAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, uninstalledAt: s.uninstalledAt,
  });

  async function stateOf(t: { id: string; billingLock: { legacyMonthlyGrossPaisa: bigint; legacyPeriodMonths: number; coversApps: string[]; lockEnd: Date } | null }, couponId?: string) {
    const subs = await db().subscription.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "asc" } });
    const monthly = subs.find((s) => s.periodMonths === 1 && s.currentPeriodEnd && s.currentPeriodEnd > new Date() && !s.uninstalledAt);
    const business: BillingState = {
      anchorDay: monthly?.currentPeriodEnd ? anchorOf(monthly.currentPeriodEnd) : null,
      subscriptions: subs.map(toState),
      lock: t.billingLock ? { legacyMonthlyGrossPaisa: n(t.billingLock.legacyMonthlyGrossPaisa), legacyPeriodMonths: t.billingLock.legacyPeriodMonths, coversApps: t.billingLock.coversApps, lockEnd: t.billingLock.lockEnd } : null,
      couponUsesByBusiness: couponId ? await db().couponRedemption.count({ where: { couponId, tenantId: t.id } }) : 0,
      couponUsesTotal: couponId ? await db().couponRedemption.count({ where: { couponId } }) : 0,
    };
    return { subs, business };
  }

  async function couponOf(code?: string) {
    if (!code) return null;
    const c = await db().coupon.findUnique({ where: { code } });
    if (!c) throw badRequest("That code doesn't exist.");
    const input: CouponInput = {
      code: c.code, kind: c.kind as CouponInput["kind"], value: c.value, appliesTo: c.appliesTo as CouponInput["appliesTo"], appIds: c.appIds, editionIds: c.editionIds,
      firstPurchaseOnly: c.firstPurchaseOnly, minSpendPaisa: c.minSpendPaisa == null ? null : n(c.minSpendPaisa), validFrom: c.validFrom, validTo: c.validTo,
      maxRedemptions: c.maxRedemptions, perBusinessLimit: c.perBusinessLimit, active: c.active,
    };
    return { id: c.id, input };
  }

  async function quoteFor(t: Parameters<typeof stateOf>[0], items: CartItem[], code?: string) {
    const [{ catalog, billing }, coupon] = await Promise.all([settings(), couponOf(code)]);
    const { business } = await stateOf(t, coupon?.id);
    const q = quote({ now: new Date(), business, items, coupon: coupon?.input ?? null, catalog, settings: billing });
    return { q, catalog, billing, coupon };
  }

  const quoteJson = (q: ReturnType<typeof quote>) => ({
    ...q, lines: q.lines.map((l) => ({ ...l, periodStart: l.periodStart?.toISOString() ?? null, periodEnd: l.periodEnd?.toISOString() ?? null })), dueAt: q.dueAt.toISOString(),
  });

  /** Starts a payment of a stored app invoice with Sheetal's own gateway (never a business's). */
  async function startPayment(ws: Workspace, invoice: { id: string; total: number; totalPaisa: bigint | null; tenantId: string }, provider: "esewa" | "khalti" | "fonepay" | "manual") {
    const paisa = invoice.totalPaisa ?? 0n;
    const g = await gateways(db(), vault, env === "production");
    // A Sheetal connection paused or down in the Integration Center is not offered (MB 12).
    if (provider !== "manual") {
      const conns = await loadPaymentConnections(db(), "sheetal.subscription", ws.tenantId);
      const row = conns.find((c) => c.integrationId === provider);
      if (row && !resolvePaymentMethods({ purpose: "sheetal.subscription", tenantId: ws.tenantId, connections: conns, env }).some((m) => m.kind === "gateway" && m.connectionId === row.id)) {
        throw new AppError(400, "method_off", "That payment method isn't available right now.");
      }
    }
    const ref = `SA${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const mode = provider !== "manual" && g[provider]?.mode === "test" ? "test" : "live";
    const payment = await db().payment.create({ data: { invoiceId: invoice.id, tenantId: ws.tenantId, provider, amount: invoice.total, amountPaisa: paisa, mode, ref, userId: ws.user.id } });
    const back = `${site}/business/billing/return/${provider}/${payment.id}`;
    const off = () => { throw new AppError(400, "method_off", "That payment method isn't available right now."); };
    try {
      if (provider === "esewa") { if (!g.esewa) off(); return { paymentId: payment.id, invoiceId: invoice.id, ...esewaCheckout({ ...g.esewa!, amount: invoice.total, amountPaisa: paisa, ref, successUrl: back, failureUrl: `${back}?failed=1` }) }; }
      if (provider === "khalti") {
        if (!g.khalti) off();
        const c = await khaltiCheckout({ ...g.khalti!, amount: invoice.total, amountPaisa: paisa, ref, name: "Sheetal Property apps", returnUrl: back, websiteUrl: site, customer: { name: ws.user.userName, email: ws.user.email, phone: ws.user.phone ?? undefined }, fetch: opts.fetch });
        if (c.method === "redirect" && c.providerRef) await db().payment.update({ where: { id: payment.id }, data: { providerRef: c.providerRef } });
        return { paymentId: payment.id, invoiceId: invoice.id, ...c };
      }
      if (provider === "fonepay") { if (!g.fonepay) off(); return { paymentId: payment.id, invoiceId: invoice.id, ...fonepayCheckout({ ...g.fonepay!, amount: invoice.total, amountPaisa: paisa, ref, returnUrl: back, remarks: "Sheetal Property apps" }) }; }
      if (!g.manual) off();
      return { paymentId: payment.id, invoiceId: invoice.id, method: "manual", amount: rupeesText(paisa), reference: ref, bank: (await billingSettings(db())).bank };
    } catch (e) {
      await db().payment.update({ where: { id: payment.id }, data: { status: "failed", note: e instanceof Error ? e.message.slice(0, 300) : "failed" } });
      throw e;
    }
  }

  async function event(subscriptionId: string, tenantId: string, appId: string, type: string, actorId: string, o: { from?: string | null; to?: string | null; reason?: string } = {}) {
    await db().subscriptionEvent.create({ data: { subscriptionId, tenantId, appId, type, fromStatus: o.from ?? null, toStatus: o.to ?? null, actorKind: "user", actorId, reason: o.reason ?? null } });
  }

  // ───────────── Reading ─────────────

  app.get("/marketplace", async (request) => {
    const { t } = await payer(request, false);
    const { catalog, billing } = await settings();
    const subs = t.billingMode === "apps" ? await db().subscription.findMany({ where: { tenantId: t.id } }) : [];
    const now = new Date();
    const mine = Object.fromEntries(subs.map((s) => {
      const es = effectiveStatus(toState(s), now, { freeEditionEnabled: catalog.apps[s.appId]?.freeEditionEnabled ?? false, settings: billing });
      return [s.appId, { installed: !s.uninstalledAt, status: es.status, access: s.uninstalledAt ? "none" : es.access, edition: es.edition, periodMonths: s.periodMonths, periodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, trialUsed: !!s.trialUsedAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, pendingEditionId: s.pendingEditionId }];
    }));
    return { data: { mode: t.billingMode, salesEnabled: billing.salesEnabled, catalog: publicCatalog(catalog), mine } };
  });

  app.get("/billing/overview", async (request) => {
    const { t } = await payer(request);
    const invoices = await db().invoice.findMany({ where: { tenantId: t.id, kind: { in: ["subscription", "credit"] } }, orderBy: { createdAt: "desc" }, take: 50, include: { lines: { orderBy: { sort: "asc" } } } });
    const { subs } = await stateOf(t);
    // The price protection of a business moved from today's plans (BE-10), for the Subscriptions page's card (P3-FE-1).
    const l = t.billingLock;
    return { data: {
      lock: l ? { monthlyGrossPaisa: n(l.legacyMonthlyGrossPaisa), periodMonths: l.legacyPeriodMonths, coversApps: l.coversApps, lockEnd: l.lockEnd } : null,
      subscriptions: subs.map((s) => ({ appId: s.appId, editionId: s.editionId, status: s.status, periodMonths: s.periodMonths, priceGrossPaisa: n(s.priceGrossPaisa), currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, installed: !s.uninstalledAt })),
      invoices: invoices.map((i) => ({
        id: i.id, kind: i.kind, status: i.status, number: i.no && i.fy ? taxNumber(i.fy, i.no, i.kind) : null, issuedAt: i.issuedAt, dueAt: i.dueAt, paidAt: i.paidAt,
        subtotalPaisa: n(i.subtotalPaisa), vatPaisa: n(i.vatPaisa), totalPaisa: n(i.totalPaisa),
        lines: i.lines.map((l) => ({ kind: l.kind, appId: l.appId, editionId: l.editionId, description: l.description, qty: l.qty, grossPaisa: n(l.grossPaisa), discountPaisa: n(l.discountPaisa), periodStart: l.periodStart, periodEnd: l.periodEnd })),
      })),
    } };
  });

  // ───────────── Free apps and trials ─────────────

  app.post<{ Params: { appId: string } }>("/subscriptions/:appId/install", async (request) => {
    const { ws, t } = await payer(request);
    const appId = AppId.parse(request.params.appId);
    const { catalog } = await settings();
    const a = catalog.apps[appId];
    if (!a || !a.visible || a.availability !== "live") throw notFound("That app isn't in the marketplace.");
    if (!a.freeEditionEnabled || !a.editions.free) throw badRequest(`${a.name?.en ?? appId} has no free edition. Start a trial or buy it.`);
    const have = await db().subscription.findUnique({ where: { tenantId_appId: { tenantId: t.id, appId } } });
    if (have && !have.uninstalledAt) throw new AppError(409, "already_installed", `${a.name?.en ?? appId} is already installed.`);
    // Installing again after a remove brings everything back (nothing was deleted); a paid period still running keeps its edition.
    const sub = have
      ? await db().subscription.update({ where: { id: have.id }, data: { uninstalledAt: null, installedAt: new Date(), version: { increment: 1 } } })
      : await db().subscription.create({ data: { tenantId: t.id, appId, editionId: "free", status: "active", source: "install" } });
    await event(sub.id, t.id, appId, "installed", ws.user.id, { to: sub.status });
    return { message: `${a.name?.en ?? appId} is installed.`, data: { appId, editionId: sub.editionId } };
  });

  app.post<{ Params: { appId: string } }>("/subscriptions/:appId/trial", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const { ws, t } = await payer(request);
    const appId = AppId.parse(request.params.appId);
    const b = Trial.parse(request.body ?? {});
    const { catalog } = await settings();
    const a = catalog.apps[appId];
    if (!a || !a.visible || a.availability !== "live") throw notFound("That app isn't in the marketplace.");
    const editionId = b.editionId ?? Object.entries(a.editions).filter(([, e]) => !e.free).sort(([, x], [, y]) => x.sort - y.sort)[0]?.[0];
    if (!a.trialDays || !editionId || a.editions[editionId]?.free !== false) throw badRequest(`${a.name?.en ?? appId} has no trial.`);
    const have = await db().subscription.findUnique({ where: { tenantId_appId: { tenantId: t.id, appId } } });
    if (have?.trialUsedAt) throw new AppError(409, "trial_used", "This business has already tried this app. Buy it to continue.");
    if (have?.periodMonths != null && have.currentPeriodEnd && have.currentPeriodEnd > new Date()) throw new AppError(409, "already_paid", "You already pay for this app.");
    // Abuse check: the same owner's other business already tried this app.
    const others = ws.user.memberships.filter((m) => m.tenantId !== t.id && m.role.perms.includes("*")).map((m) => m.tenantId);
    if (others.length && await db().subscription.count({ where: { tenantId: { in: others }, appId, trialUsedAt: { not: null } } })) {
      throw new AppError(409, "trial_used", "You have already tried this app with another business. Buy it to continue.");
    }
    const now = new Date();
    const data = { editionId, status: "trialing", periodMonths: null, currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: addNepalDays(now, a.trialDays), trialUsedAt: now, uninstalledAt: null, source: "trial" };
    const sub = have
      ? await db().subscription.update({ where: { id: have.id }, data: { ...data, version: { increment: 1 } } })
      : await db().subscription.create({ data: { ...data, tenantId: t.id, appId } });
    await event(sub.id, t.id, appId, "trial_started", ws.user.id, { from: have?.status ?? null, to: "trialing" });
    return { message: `Your ${a.trialDays}-day trial of ${a.name?.en ?? appId} has started. No card needed.`, data: { appId, editionId, trialEndsAt: sub.trialEndsAt } };
  });

  // ───────────── The cart ─────────────

  const quoteRoute = async (request: Parameters<typeof workspaceOf>[0]) => {
    const { t } = await payer(request);
    const b = Cart.parse(request.body);
    const { q } = await quoteFor(t, b.items, b.couponCode);
    return { data: quoteJson(q) };
  };
  app.post("/subscriptions/quote", quoteRoute);
  app.post("/addons/quote", quoteRoute);

  app.post("/coupons/check", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (request) => {
    const { t } = await payer(request);
    const b = CouponCheck.parse(request.body);
    const { q } = await quoteFor(t, b.items, b.couponCode);
    const err = q.errors.find((e) => /code/i.test(e.en));
    return err ? { data: { ok: false, reason: err.en } } : { data: { ok: true, discountPaisa: q.discountPaisa, totalPaisa: q.totalPaisa } };
  });

  const checkoutRoute = async (request: Parameters<typeof workspaceOf>[0]) => {
    const { ws, t } = await payer(request);
    const b = Checkout.parse(request.body);
    const { q, catalog, billing, coupon } = await quoteFor(t, b.items, b.couponCode);
    if (!billing.salesEnabled) throw new AppError(409, "sales_off", "Sheetal isn't selling apps yet. Please try again soon.");
    if (q.errors.length) throw badRequest(q.errors[0]!.en, { cart: q.errors.map((e) => e.en) });
    if (!q.lines.length) throw badRequest(q.notes[0]?.en ?? "There is nothing to pay.");
    const invoice = await db().$transaction((tx) => createInvoiceFromQuote(tx, { tenantId: t.id, quote: q, by: ws.user.id, billedTo: { name: t.name }, couponId: coupon?.id ?? null, catalogVersion: catalog.version }));
    if (q.totalPaisa === 0) {
      // Nothing to pay (a 100% coupon or a free switch): applied at once, no tax invoice number (MB 9.1).
      const p = await db().payment.create({ data: { invoiceId: invoice.id, tenantId: t.id, provider: "coupon", amount: 0, amountPaisa: 0n, ref: `SA0${randomBytes(5).toString("hex").toUpperCase()}`, userId: ws.user.id } });
      const share = await store().get(REVENUE_SHARE);
      const seller = sellerSnapshot(await store().get(COMPANY_SETTING), (await platformSettings(db())).siteName);
      await db().$transaction((tx) => applySubscriptionPayment(tx, { paymentId: p.id, now: new Date(), appSales: share.appSales, share, seller }));
      // The Listings limit may have changed: listings paused for the limit come back (or the extra ones pause) at once. Never fails the checkout.
      await reconcileListingLimit(db(), t.id).catch((e) => request.log.warn({ err: e, tenantId: t.id }, "listing limit: could not reconcile after checkout"));
      return { message: "Done. Your apps are ready.", data: { invoiceId: invoice.id, paid: true } };
    }
    return { data: { ...(await startPayment(ws, invoice, b.provider)), totalPaisa: q.totalPaisa } };
  };
  app.post("/subscriptions/checkout", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, checkoutRoute);
  app.post("/addons/checkout", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, checkoutRoute);

  /** Pays an open app invoice (a renewal the job made, or one left unpaid). */
  app.post("/subscriptions/invoices/pay", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (request) => {
    const { ws, t } = await payer(request);
    const b = PayInvoice.parse(request.body);
    const invoice = await db().invoice.findFirst({ where: { id: b.invoiceId, tenantId: t.id, kind: "subscription" } });
    if (!invoice) throw notFound("Invoice not found.");
    if (invoice.status !== "open") throw badRequest(invoice.status === "paid" ? "This invoice is already paid." : "This invoice was cancelled.");
    return { data: await startPayment(ws, invoice, b.provider) };
  });

  // ───────────── Changing a subscription ─────────────

  async function subOf(t: { id: string }, appId: string) {
    const s = await db().subscription.findUnique({ where: { tenantId_appId: { tenantId: t.id, appId } } });
    if (!s || s.uninstalledAt) throw notFound("That app isn't installed.");
    return s;
  }

  app.post<{ Params: { appId: string } }>("/subscriptions/:appId/change", async (request) => {
    const { ws, t } = await payer(request);
    const appId = AppId.parse(request.params.appId);
    const b = Change.parse(request.body);
    const s = await subOf(t, appId);
    const { q } = await quoteFor(t, [{ kind: "change", appId, editionId: b.editionId, periodMonths: b.periodMonths }]);
    if (q.errors.length) throw badRequest(q.errors[0]!.en);
    if (q.lines.length) throw new AppError(402, "payment_needed", `This change costs Rs ${rupeesText(q.totalPaisa)}. Pay it in the cart.`, undefined, { quote: quoteJson(q) });
    // A downgrade or a year-to-month switch waits for the period end.
    await db().subscription.update({ where: { id: s.id }, data: { pendingEditionId: b.editionId === s.editionId ? null : b.editionId, pendingPeriodMonths: b.periodMonths === s.periodMonths ? null : b.periodMonths, version: { increment: 1 } } });
    await event(s.id, t.id, appId, "downgrade_scheduled", ws.user.id, { reason: `${b.editionId}, ${b.periodMonths} month(s)` });
    return { message: q.notes[0]?.en ?? "Changed at the period end.", data: { scheduled: true } };
  });

  app.post<{ Params: { appId: string } }>("/subscriptions/:appId/cancel", async (request) => {
    const { ws, t } = await payer(request);
    const appId = AppId.parse(request.params.appId);
    const b = Cancel.parse(request.body ?? {});
    const s = await subOf(t, appId);
    if (s.status === "trialing") {
      await db().subscription.update({ where: { id: s.id }, data: { trialEndsAt: new Date(), version: { increment: 1 } } });
      await event(s.id, t.id, appId, "cancelled", ws.user.id, { from: "trialing", reason: b.reason });
      return { message: "The trial has ended. Your data stays; the free edition goes on." };
    }
    if (s.periodMonths == null) throw badRequest("A free edition has nothing to cancel. Remove the app instead.");
    if (s.cancelAtPeriodEnd) return { message: "Already cancelled: it ends at the period end." };
    await db().subscription.update({ where: { id: s.id }, data: { cancelAtPeriodEnd: true, cancelledAt: new Date(), version: { increment: 1 } } });
    await event(s.id, t.id, appId, "cancelled", ws.user.id, { from: s.status, reason: b.reason });
    return { message: `Cancelled. You keep everything until ${s.currentPeriodEnd?.toISOString().slice(0, 10)}; nothing renews.` };
  });

  app.post<{ Params: { appId: string } }>("/subscriptions/:appId/resume", async (request) => {
    const { ws, t } = await payer(request);
    const s = await subOf(t, AppId.parse(request.params.appId));
    if (!s.cancelAtPeriodEnd && s.status !== "cancelled") return { message: "It wasn't cancelled." };
    if (!s.currentPeriodEnd || s.currentPeriodEnd <= new Date()) throw badRequest("The period has ended. Buy it again instead.");
    await db().subscription.update({ where: { id: s.id }, data: { cancelAtPeriodEnd: false, cancelledAt: null, status: "active", version: { increment: 1 } } });
    await event(s.id, t.id, s.appId, "resumed", ws.user.id, { to: "active" });
    return { message: "Resumed: it renews as before." };
  });

  app.post<{ Params: { appId: string } }>("/subscriptions/:appId/remove", async (request) => {
    const { ws, t } = await payer(request);
    const s = await subOf(t, AppId.parse(request.params.appId));
    if (s.periodMonths != null && s.currentPeriodEnd && s.currentPeriodEnd > new Date() && !s.cancelAtPeriodEnd) {
      throw badRequest("You still pay for this app. Cancel it first; it can be removed after the period ends.");
    }
    await db().subscription.update({ where: { id: s.id }, data: { uninstalledAt: new Date(), version: { increment: 1 } } });
    await event(s.id, t.id, s.appId, "removed", ws.user.id);
    return { message: "Removed. Nothing was deleted: install it again any time to see everything." };
  });
}
