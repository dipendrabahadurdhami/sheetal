import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { hotelBill } from "@sheetal/backend-core/domain/money";
import { branchFor, branchView, inView, workspaceOf, type BranchView, type Workspace } from "../access.js";

// Point of sale for restaurants, bars and extras: the menu, cashier shifts, and bills paid on the spot or put on a
// guest's room. Cash bills need an open shift, so the cash in the drawer can be counted at the end.
// Each branch has its own till (shift) and bills; a menu item is on every branch's menu, or just one branch's.
// The till works on one branch: the one picked in the panel (or the person's only branch).

const METHODS = ["cash", "fonepay", "card", "esewa", "khalti", "room"] as const;
export const billCode = (b: { seq: number }) => `POS-${String(b.seq).padStart(5, "0")}`;

export async function posRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const need = (ws: Workspace, ...perms: string[]) => { if (!perms.some(ws.can)) throw forbidden("Your role can't do this."); };
  const openShift = (tenantId: string, branchId: string) => db().shift.findFirst({ where: { tenantId, branchId, closedAt: null }, orderBy: { openedAt: "desc" } });
  /** The branch whose till this is: the one picked, else the person's only (or first open) branch. */
  const till = async (ws: Workspace, request: FastifyRequest) => branchFor(await branchView(db(), request, ws));
  /** Menu items on a branch's menu: shared ones plus that branch's own. */
  const onMenu = (v: BranchView): Prisma.MenuItemWhereInput => (v.ids ? { OR: [{ branchId: null }, { branchId: { in: v.ids } }] } : {});

  // ───── Menu ─────
  app.get("/menu", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "pos.restaurant", "pos.extras", "pos.frontdesk", "settings.business");
    return { data: await db().menuItem.findMany({ where: { tenantId: ws.tenantId, ...onMenu(await branchView(db(), request, ws)) }, orderBy: [{ outlet: "asc" }, { category: "asc" }, { name: "asc" }] }) };
  });
  app.post("/menu", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "settings.business");
    const b = z.object({ items: z.array(z.object({ name: z.string().trim().min(1).max(80), price: z.number().int().min(0).max(1_000_000), category: z.string().trim().max(40).default("Food"), outlet: z.string().trim().max(40).default("Restaurant") })).min(1).max(500), branchId: z.string().max(40).nullish() }).parse(request.body);
    // No branch: on every branch's menu (only for people with all branches); otherwise that branch's own.
    const v = await branchView(db(), request, ws);
    if (!b.branchId && v.ids) throw forbidden("Pick one of your branches for these items.");
    const branchId = b.branchId ? branchFor(v, b.branchId) : null;
    await db().menuItem.createMany({ data: b.items.map((i) => ({ ...i, tenantId: ws.tenantId, branchId })) });
    return { message: `${b.items.length} item${b.items.length > 1 ? "s" : ""} added to the menu.` };
  });
  app.patch<{ Params: { id: string } }>("/menu/:id", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "settings.business");
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), price: z.number().int().min(0).optional(), category: z.string().max(40).optional(), outlet: z.string().max(40).optional(), active: z.boolean().optional() }).parse(request.body);
    const v = await branchView(db(), request, ws);
    // Shared items can only be changed by people with all branches.
    const r = await db().menuItem.updateMany({ where: { id: request.params.id, tenantId: ws.tenantId, ...(v.ids ? { branchId: { in: v.ids } } : {}) }, data: b });
    if (!r.count) throw notFound("Item not found.");
    return { message: "Saved." };
  });

  // ───── Shifts ─────
  app.get("/shifts/current", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "pos.restaurant", "pos.frontdesk", "pos.extras", "shift.close");
    const s = await openShift(ws.tenantId, await till(ws, request));
    if (!s) return { data: null };
    const bills = await db().posBill.groupBy({ by: ["method"], where: { shiftId: s.id, status: "paid" }, _sum: { total: true } });
    const sales = Object.fromEntries(bills.map((b) => [b.method, b._sum.total ?? 0]));
    return { data: { id: s.id, openedAt: s.openedAt, float: s.float, sales, expectedCash: s.float + (sales.cash ?? 0) } };
  });
  app.post("/shifts/open", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "pos.restaurant", "pos.frontdesk", "shift.close");
    const { float } = z.object({ float: z.number().int().min(0).max(10_000_000).default(0) }).parse(request.body);
    const branchId = await till(ws, request);
    if (await openShift(ws.tenantId, branchId)) throw badRequest("A shift is already open at this branch. Close it first.");
    await db().shift.create({ data: { tenantId: ws.tenantId, branchId, openedBy: ws.user.id, float } });
    return { message: "Shift opened." };
  });
  app.post("/shifts/close", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "shift.close");
    const { counted } = z.object({ counted: z.number().int().min(0).max(100_000_000) }).parse(request.body);
    const s = await openShift(ws.tenantId, await till(ws, request));
    if (!s) throw badRequest("No shift is open at this branch.");
    const cash = (await db().posBill.aggregate({ where: { shiftId: s.id, status: "paid", method: "cash" }, _sum: { total: true } }))._sum.total ?? 0;
    const diff = counted - (s.float + cash);
    await db().shift.update({ where: { id: s.id }, data: { closedAt: new Date(), closedBy: ws.user.id, counted, diff } });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "shift.closed", target: `expected Rs. ${s.float + cash}, counted Rs. ${counted}`, ip: request.ip } });
    return { message: diff === 0 ? "Shift closed. The cash matches." : `Shift closed. Cash is ${diff > 0 ? "over" : "short"} by Rs. ${Math.abs(diff).toLocaleString("en-IN")}.`, data: { expected: s.float + cash, counted, diff } };
  });

  // ───── Bills ─────
  app.get("/pos/bills", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "pos.restaurant", "pos.frontdesk", "pos.extras", "shift.close", "invoices.view");
    const { day } = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(request.query);
    const from = day ? new Date(`${day}T00:00:00+05:45`) : new Date(Date.now() - 864e5);
    const rows = await db().posBill.findMany({ where: { tenantId: ws.tenantId, ...inView(await branchView(db(), request, ws)), createdAt: { gte: from, lt: new Date(from.getTime() + (day ? 864e5 : 2 * 864e5)) } }, orderBy: { createdAt: "desc" } });
    return { data: rows.map((b) => ({ ...b, code: billCode(b) })) };
  });

  app.post("/pos/bills", async (request) => {
    const ws = workspaceOf(request);
    const b = z.object({
      outlet: z.string().trim().min(1).max(40), method: z.enum(METHODS), bookingId: z.string().max(40).optional(), discount: z.number().int().min(0).default(0),
      lines: z.array(z.object({ itemId: z.string().max(40).optional(), name: z.string().trim().min(1).max(80), qty: z.number().int().min(1).max(999), price: z.number().int().min(0).max(1_000_000) })).min(1).max(100),
    }).parse(request.body);
    need(ws, "pos.restaurant", "pos.extras", "pos.frontdesk");
    if (b.discount > 0) need(ws, "pos.discount");
    // Prices come from the menu when the item is on it, so a bill can't be rung up below the menu price.
    const branchId = await till(ws, request);
    const items = new Map((await db().menuItem.findMany({ where: { tenantId: ws.tenantId, OR: [{ branchId: null }, { branchId }], id: { in: b.lines.map((l) => l.itemId).filter((x): x is string => !!x) } } })).map((i) => [i.id, i]));
    const lines = b.lines.map((l) => { const m = l.itemId ? items.get(l.itemId) : undefined; return { itemId: m?.id, name: m?.name ?? l.name, qty: l.qty, price: m?.price ?? l.price }; });
    const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
    if (b.discount > subtotal) throw badRequest("The discount is more than the bill.");
    const shift = await openShift(ws.tenantId, branchId);
    if (b.method === "cash" && !shift) throw badRequest("Open a shift before taking cash.");
    let booking = null;
    if (b.method === "room") {
      booking = await db().booking.findFirst({ where: { id: b.bookingId ?? "-", tenantId: ws.tenantId, branchId, status: "checked_in" }, include: { room: true } });
      if (!booking) throw badRequest("Pick a guest who is checked in at this branch.");
    }
    const bill = hotelBill(subtotal, b.discount);
    const created = await db().$transaction(async (tx) => {
      const pb = await tx.posBill.create({ data: { tenantId: ws.tenantId, branchId, shiftId: shift?.id, outlet: b.outlet, lines, ...bill, method: b.method, bookingId: booking?.id, byUserId: ws.user.id } });
      // On the room: the amount before service and VAT goes on the folio; those are added once, on the room bill.
      if (booking) await tx.folioLine.create({ data: { bookingId: booking.id, kind: "pos", what: `${b.outlet} bill ${billCode(pb)}`, amount: subtotal - b.discount, byUserId: ws.user.id } });
      return pb;
    });
    return { message: booking ? `Put on room ${booking.room?.no} (${booking.guestName}).` : `Paid: Rs. ${bill.total.toLocaleString("en-IN")}.`, data: { ...created, code: billCode(created) } };
  });

  app.post<{ Params: { id: string } }>("/pos/bills/:id/void", async (request) => {
    const ws = workspaceOf(request);
    need(ws, "pos.void");
    const { note } = z.object({ note: z.string().trim().min(3, "Say why.").max(200) }).parse(request.body);
    const pb = await db().posBill.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, ...inView(await branchView(db(), request, ws)) } });
    if (!pb || pb.status !== "paid") throw notFound("Bill not found.");
    await db().$transaction(async (tx) => {
      await tx.posBill.update({ where: { id: pb.id }, data: { status: "void", voidNote: note } });
      if (pb.bookingId) await tx.folioLine.create({ data: { bookingId: pb.bookingId, kind: "pos", what: `Void ${billCode(pb)}: ${note}`, amount: -(pb.subtotal - pb.discount), byUserId: ws.user.id } });
    });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "pos.void", target: `${billCode(pb)} Rs. ${pb.total}: ${note}`, ip: request.ip } });
    return { message: "Bill voided." };
  });
}
