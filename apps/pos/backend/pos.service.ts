// The rules of the point of sale (restaurants, bars and extras): the menu, cashier shifts (tills) and bills, on the kernel. Moved from
// business/backend/src/modules/pos/routes.ts (P2-W4); every rule and message unchanged.
// Where it fits: PosController calls one method per route.
// How it works: each branch has its own till and bills; menu items are shared by every branch or belong to one; a bill is paid on the spot or put on a
// checked-in guest's room bill (its line goes on the room bill in the same transaction). A paid bill takes out the stock its menu items use (recipes); a void
// puts it back. Each change runs in ONE transaction with its audit line (the old strings where there was one) and its event.
// Rules: prices come from the menu, not the browser; cash needs an open shift so the drawer can be counted; discounts and voids need their own permissions;
// the till works on one branch at a time; a bill is voided once, a shift closed once.

import { z } from "zod";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import { monthStart, requireRoom } from "@sheetal/platform/billing/room";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { hotelBill } from "@sheetal/backend-core/domain/money";
import { reverseSale, saleMoves } from "@sheetal/backend-core/domain/stock";
import { PosBase, SETTINGS, need } from "./common.js";
import { BillRepository, MenuRepository, ShiftRepository, db, viewIds } from "./repositories.js";

const METHODS = ["cash", "fonepay", "card", "esewa", "khalti", "room"] as const;
export const billCode = (b: { seq: number }) => `POS-${String(b.seq).padStart(5, "0")}`;

const MenuAdd = z.object({ items: z.array(z.object({ name: z.string().trim().min(1).max(80), price: z.number().int().min(0).max(1_000_000), category: z.string().trim().max(40).default("Food"), outlet: z.string().trim().max(40).default("Restaurant") })).min(1).max(500), branchId: z.string().max(40).nullish() });
const MenuEdit = z.object({ name: z.string().trim().min(1).max(80).optional(), price: z.number().int().min(0).optional(), category: z.string().max(40).optional(), outlet: z.string().max(40).optional(), active: z.boolean().optional(), version: z.number().int().min(1).optional() });
const Bill = z.object({
  outlet: z.string().trim().min(1).max(40), method: z.enum(METHODS), bookingId: z.string().max(40).optional(), discount: z.number().int().min(0).default(0),
  lines: z.array(z.object({ itemId: z.string().max(40).optional(), name: z.string().trim().min(1).max(80), qty: z.number().int().min(1).max(999), price: z.number().int().min(0).max(1_000_000) })).min(1).max(100),
});

export class PosService extends PosBase {
  readonly menu = new MenuRepository();
  readonly shifts = new ShiftRepository();
  readonly bills = new BillRepository();
  constructor(deps: { bus: EventBus }) { super("bill", deps.bus); }

  /** The branch whose till this is: the one picked, else the person's only (or first open) branch. */
  private till(ctx: BusinessContext) { return ctx.branches.branchForNew(); }

  // ───── Menu ─────
  async menuList(ctx: BusinessContext) {
    need(ctx, "pos.restaurant.use", "pos.extra.create", "pos.frontdesk.use", SETTINGS);
    return this.menu.list(ctx);
  }
  async menuAdd(ctx: BusinessContext, raw: unknown) {
    need(ctx, SETTINGS);
    const b = MenuAdd.parse(raw);
    // No branch: on every branch's menu (only for people with all branches); otherwise that branch's own.
    if (!b.branchId && viewIds(ctx)) throw forbidden("Pick one of your branches for these items.");
    const branchId = b.branchId ? ctx.branches.branchForNew(b.branchId) : null;
    await this.write(ctx, (tx) => this.menu.addMany(tx, b.items, branchId), () => ({ event: { name: "pos.menu.added", payload: { count: b.items.length }, branchId } }));
    return { message: `${b.items.length} item${b.items.length > 1 ? "s" : ""} added to the menu.` };
  }
  async menuEdit(ctx: BusinessContext, id: string, raw: unknown) {
    need(ctx, SETTINGS);
    const { version, ...b } = MenuEdit.parse(raw);
    await this.write(ctx, async (tx) => {
      // Shared items can only be changed by people with all branches.
      if (!(await this.menu.change(tx, id, b, version))) {
        if (version !== undefined && (await this.menu.exists(tx, id))) throw conflict("Someone else changed this item. Reload to see the latest.");
        throw notFound("Item not found.");
      }
      return id;
    }, () => ({ event: { name: "pos.menu.updated", payload: { id } } }));
    return { message: "Saved." };
  }

  // ───── Shifts ─────
  async currentShift(ctx: BusinessContext) {
    need(ctx, "pos.restaurant.use", "pos.frontdesk.use", "pos.extra.create", "pos.shift.close");
    const s = await this.shifts.open(ctx, this.till(ctx));
    if (!s) return null;
    const sales = Object.fromEntries((await this.shifts.salesByMethod(ctx, s.id)).map((b) => [b.method, b._sum.total ?? 0]));
    return { id: s.id, openedAt: s.openedAt, float: s.float, sales, expectedCash: s.float + (sales.cash ?? 0) };
  }
  async openShift(ctx: BusinessContext, raw: unknown) {
    need(ctx, "pos.restaurant.use", "pos.frontdesk.use", "pos.shift.close");
    const { float } = z.object({ float: z.number().int().min(0).max(10_000_000).default(0) }).parse(raw ?? {});
    const branchId = this.till(ctx);
    if (await this.shifts.open(ctx, branchId)) throw badRequest("A shift is already open at this branch. Close it first.");
    await this.write(ctx, async (tx) => {
      if (await this.shifts.open(tx, branchId)) throw badRequest("A shift is already open at this branch. Close it first.");
      return this.shifts.start(tx, branchId, float);
    }, (s) => ({ event: { name: "pos.shift.opened", payload: { id: s.id, float }, branchId } }));
    return { message: "Shift opened." };
  }
  async closeShift(ctx: BusinessContext, raw: unknown) {
    need(ctx, "pos.shift.close");
    const { counted } = z.object({ counted: z.number().int().min(0).max(100_000_000) }).parse(raw);
    const branchId = this.till(ctx);
    const s = await this.shifts.open(ctx, branchId);
    if (!s) throw badRequest("No shift is open at this branch.");
    const r = await this.write(ctx, async (tx) => {
      const cash = await this.shifts.cash(tx, s.id);
      const diff = counted - (s.float + cash);
      if (!(await this.shifts.close(tx, s.id, counted, diff))) throw badRequest("No shift is open at this branch.");
      return { expected: s.float + cash, counted, diff };
    }, (x) => ({ audit: { action: "shift.closed", target: `expected Rs. ${x.expected}, counted Rs. ${counted}` }, event: { name: "pos.shift.closed", payload: { id: s.id, ...x }, branchId } }));
    return { message: r.diff === 0 ? "Shift closed. The cash matches." : `Shift closed. Cash is ${r.diff > 0 ? "over" : "short"} by Rs. ${Math.abs(r.diff).toLocaleString("en-IN")}.`, data: r };
  }

  // ───── Bills ─────
  async billList(ctx: BusinessContext, rawQuery: unknown) {
    need(ctx, "pos.restaurant.use", "pos.frontdesk.use", "pos.extra.create", "pos.shift.close", "invoicing.invoice.read");
    const { day } = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(rawQuery);
    const from = day ? new Date(`${day}T00:00:00+05:45`) : new Date(Date.now() - 864e5);
    return (await this.bills.between(ctx, from, new Date(from.getTime() + (day ? 864e5 : 2 * 864e5)))).map((b) => ({ ...b, code: billCode(b) }));
  }

  async ring(ctx: BusinessContext, raw: unknown) {
    const b = Bill.parse(raw);
    need(ctx, "pos.restaurant.use", "pos.extra.create", "pos.frontdesk.use");
    if (b.discount > 0) need(ctx, "pos.bill.discount");
    // On app subscriptions: the Point of sale edition's bills a month (free 100; a soft limit: 20% over is allowed so a sale is not lost).
    await requireRoom(ctx, "pos", "bills_per_month", () => ctx.db.posBill.count({ where: { tenantId: ctx.business.id, deletedAt: null, createdAt: { gte: monthStart(ctx.now) } } }));
    // Prices come from the menu when the item is on it, so a bill can't be rung up below the menu price.
    const branchId = this.till(ctx);
    const items = new Map((await this.menu.forBill(ctx, branchId, b.lines.map((l) => l.itemId).filter((x): x is string => !!x))).map((i) => [i.id, i]));
    const lines = b.lines.map((l) => { const m = l.itemId ? items.get(l.itemId) : undefined; return { itemId: m?.id, name: m?.name ?? l.name, qty: l.qty, price: m?.price ?? l.price }; });
    const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
    if (b.discount > subtotal) throw badRequest("The discount is more than the bill.");
    const shift = await this.shifts.open(ctx, branchId);
    if (b.method === "cash" && !shift) throw badRequest("Open a shift before taking cash.");
    const booking = b.method === "room" ? await this.bills.guest(ctx, b.bookingId ?? "-", branchId) : null;
    if (b.method === "room" && !booking) throw badRequest("Pick a guest who is checked in at this branch.");
    const bill = hotelBill(subtotal, b.discount);
    const created = await this.write(ctx, async (tx) => {
      const pb = await this.bills.create(tx, { branchId, shiftId: shift?.id, outlet: b.outlet, lines, ...bill, method: b.method, bookingId: booking?.id, byUserId: tx.member.userId });
      // On the room: the amount before service and VAT goes on the room bill; those are added once, on the room bill.
      if (booking) await this.bills.roomLine(tx, booking.id, `${b.outlet} bill ${billCode(pb)}`, subtotal - b.discount);
      // Stock: what the menu items use (their recipes) goes out with the sale.
      await saleMoves(db(tx), pb.id, tx.member.userId);
      return pb;
    }, (pb) => ({ event: { name: "pos.bill.paid", payload: { id: pb.id, code: billCode(pb), total: pb.total, method: b.method }, branchId } }));
    return { message: booking ? `Put on room ${booking.room?.no} (${booking.guestName}).` : `Paid: Rs. ${bill.total.toLocaleString("en-IN")}.`, data: { ...created, code: billCode(created) } };
  }

  async voidBill(ctx: BusinessContext, id: string, raw: unknown) {
    need(ctx, "pos.bill.void");
    const { note } = z.object({ note: z.string().trim().min(3, "Say why.").max(200) }).parse(raw);
    const pb = await this.bills.one(ctx, id);
    if (!pb || pb.status !== "paid") throw notFound("Bill not found.");
    await this.write(ctx, async (tx) => {
      if (!(await this.bills.voidOnce(tx, pb.id, note))) throw notFound("Bill not found.");
      // Stock: put back what the sale took out.
      await reverseSale(db(tx), pb.id, tx.member.userId);
      if (pb.bookingId) await this.bills.roomLine(tx, pb.bookingId, `Void ${billCode(pb)}: ${note}`, -(pb.subtotal - pb.discount));
      return pb;
    }, () => ({ audit: { action: "pos.void", target: `${billCode(pb)} Rs. ${pb.total}: ${note}` }, event: { name: "pos.bill.voided", payload: { id: pb.id, code: billCode(pb), total: pb.total }, branchId: pb.branchId } }));
    return { message: "Bill voided." };
  }
}
