// Add-ons on the business API: what can be bought on this plan, what is owned, buying and removing.
// Where it fits: Business → Billing → Add-ons (LiveAddons.jsx). Paying uses the normal billing checkout with the invoice.
// How it works: see backend-core/src/domain/addons.ts. Buying makes an add-on invoice for the rest of the paid period;
// it counts once paid. Removing stops it at the next renewal (it keeps working until then).
// Rules: billing.manage buys and removes; billing.manage or invoices.view reads; paid plans only.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { addonCatalog, addonExtras, monthsLeft } from "@sheetal/backend-core/domain/addons";
import { billingSettings, createAddonInvoice, invoiceNumber, repriceOpenPlanInvoices } from "@sheetal/backend-core/domain/billing";
import { workspaceOf, type Workspace } from "../access.js";

export async function addonRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const reader = (ws: Workspace) => { if (!ws.can("billing.manage") && !ws.can("invoices.view")) throw forbidden("Your role can't see billing."); };
  const payer = (ws: Workspace) => { if (!ws.can("billing.manage")) throw forbidden("Only people who manage billing can buy add-ons."); };

  app.get("/billing/addons", async (request) => {
    const ws = workspaceOf(request); reader(ws);
    const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, include: { plan: true } });
    const [cat, owned, extras, open] = await Promise.all([
      addonCatalog(db()), db().tenantAddon.findMany({ where: { tenantId: t.id } }), addonExtras(db(), t.id),
      db().invoice.findMany({ where: { tenantId: t.id, kind: "addon", status: "open" }, orderBy: { createdAt: "desc" } }),
    ]);
    const base = (t.plan.limits ?? {}) as Record<string, number>;
    const paid = t.plan.price > 0;
    const months = monthsLeft(t.renewsAt);
    return {
      data: {
        paid, canBuy: paid && ws.can("billing.manage"), monthsLeft: months, renewsAt: t.renewsAt,
        addons: cat.filter((a) => a.active && a.types.includes(t.type as never) && base[a.limitKey] !== undefined).map((a) => {
          const o = owned.find((x) => x.addonId === a.id);
          return { id: a.id, name: a.name, sub: a.sub, unit: a.unit, price: a.price, step: a.step, limitKey: a.limitKey,
            unlimited: base[a.limitKey] === -1, planLimit: base[a.limitKey], extra: extras[a.limitKey] ?? 0, qty: o?.qty ?? 0, renewQty: o?.renewQty ?? 0, nowPrice: a.price * months };
        }),
        openInvoices: open.map((i) => ({ id: i.id, number: invoiceNumber(i), total: i.total })),
      },
    };
  });

  app.post("/billing/addons", async (request) => {
    const ws = workspaceOf(request); payer(ws);
    const b = z.object({ addonId: z.string().min(1).max(40), qty: z.number().int().min(1).max(50) }).parse(request.body);
    const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, include: { plan: true } });
    if (!t.plan.price) throw badRequest("Add-ons are for paid plans. Upgrade first.");
    if (t.status === "suspended" || t.status === "cancelled") throw badRequest("This business isn't active. Please contact Sheetal.");
    const a = (await addonCatalog(db())).find((x) => x.id === b.addonId && x.active && x.types.includes(t.type as never));
    if (!a) throw notFound("That add-on isn't available for this business.");
    const base = (t.plan.limits ?? {}) as Record<string, number>;
    if (base[a.limitKey] === undefined || base[a.limitKey] === -1) throw badRequest("Your plan already has no limit for this.");
    const months = monthsLeft(t.renewsAt);
    const invoice = await createAddonInvoice(db(), { tenant: t, lines: [{ id: a.id, name: a.name, qty: b.qty, price: a.price, months }], by: ws.user.id, vatRate: (await billingSettings(db())).vatRate });
    await db().auditLog.create({ data: { tenantId: t.id, actorId: ws.user.id, action: "billing.addon_invoice", target: `${invoiceNumber(invoice)} ${a.id} × ${b.qty}`, ip: request.ip } });
    return { message: `Invoice ${invoiceNumber(invoice)} made for Rs. ${invoice.total.toLocaleString("en-IN")} (${months} month${months > 1 ? "s" : ""}, to your renewal). Pay it to start the add-on.`, data: { invoiceId: invoice.id, number: invoiceNumber(invoice), total: invoice.total } };
  });

  // Keep fewer at the next renewal (or none). What is paid keeps working until then.
  app.post<{ Params: { id: string } }>("/billing/addons/:id/renew", async (request) => {
    const ws = workspaceOf(request); payer(ws);
    const b = z.object({ renewQty: z.number().int().min(0).max(500) }).parse(request.body);
    const o = await db().tenantAddon.findUnique({ where: { tenantId_addonId: { tenantId: ws.tenantId, addonId: request.params.id.slice(0, 40) } } });
    if (!o || !o.qty) throw notFound("You don't have this add-on.");
    if (b.renewQty > o.qty) throw badRequest("Buy more to add; this only keeps fewer at the renewal.");
    await db().tenantAddon.update({ where: { id: o.id }, data: { renewQty: b.renewQty } });
    await repriceOpenPlanInvoices(db(), ws.tenantId);
    await db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action: "billing.addon_renew", target: `${o.addonId} ${o.qty} → ${b.renewQty}`, ip: request.ip } });
    return { message: b.renewQty ? `From the next renewal you keep ${b.renewQty}.` : "It stops at the next renewal. It keeps working until then." };
  });
}
