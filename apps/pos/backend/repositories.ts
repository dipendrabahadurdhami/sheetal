// The only code that reads and writes the point-of-sale and stock tables (KERNEL.md section 6): menu items, shifts (tills), POS bills, stock items, stock
// moves and recipes. It also reads the Hotel app's bookings and, for a bill put on a guest's room, adds the line to the room bill (see the rule below).
// Where it fits: PosService and StockService call these, in their transaction for a change.
// How it works: tables a person edits (menu items, bills, stock items) have the kernel columns (version, who changed it, soft-delete marks). Three tables do
// not, on purpose: shifts are opened once and closed once, stock moves are an append-only ledger written by applyMove() (backend-core domain/stock.ts),
// and a menu item's recipe is replaced as a whole set. Every query carries this business and, where the row has a branch, the branches in view
// (inView(); a menu item with no branch is on every branch's menu).
// Rules: FolioLine is the Hotel app's table, but the line for a POS bill put on a room (and its reversal on a void) is written HERE, in the same transaction as
// the bill, so a bill can never exist without its room charge or the other way round (docs/architecture/MODEL-OWNERS.md). Nothing is hard deleted except a
// recipe set being replaced.

import type { Prisma } from "@prisma/client";
import { actorIdOf, type BusinessContext } from "@sheetal/platform/core/context";

type Tx = Prisma.TransactionClient;
export const db = (ctx: BusinessContext): Tx => (ctx.tx ?? ctx.db) as unknown as Tx;
/** The branches in view (the branch picked at the top, or all of the person's); {} = the whole business. */
export const inView = (ctx: BusinessContext) => { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; };
export const viewIds = (ctx: BusinessContext) => ctx.branches.idsFor("branch");
const by = (ctx: BusinessContext) => { const me = actorIdOf(ctx); return { createdBy: me, updatedBy: me }; };
const bump = (ctx: BusinessContext) => ({ version: { increment: 1 }, updatedBy: actorIdOf(ctx) });

// ───── Menu ─────
export class MenuRepository {
  /** Menu items on the branches in view: shared ones plus those branches' own. */
  onMenu(ctx: BusinessContext): Prisma.MenuItemWhereInput { const ids = viewIds(ctx); return ids ? { OR: [{ branchId: null }, { branchId: { in: [...ids] } }] } : {}; }
  list(ctx: BusinessContext, more: Prisma.MenuItemWhereInput = {}) {
    return db(ctx).menuItem.findMany({ where: { tenantId: ctx.business.id, deletedAt: null, ...this.onMenu(ctx), ...more }, orderBy: [{ outlet: "asc" }, { category: "asc" }, { name: "asc" }] });
  }
  async addMany(ctx: BusinessContext, items: { name: string; price: number; category: string; outlet: string }[], branchId: string | null) {
    await db(ctx).menuItem.createMany({ data: items.map((i) => ({ ...i, tenantId: ctx.business.id, branchId, ...by(ctx) })) });
  }
  /** Changes an item of the person's own branches (shared items only for people with all branches). False = not found. */
  async change(ctx: BusinessContext, id: string, data: Prisma.MenuItemUpdateManyMutationInput, version?: number): Promise<boolean> {
    const ids = viewIds(ctx);
    return (await db(ctx).menuItem.updateMany({ where: { id, tenantId: ctx.business.id, deletedAt: null, ...(ids ? { branchId: { in: [...ids] } } : {}), ...(version !== undefined ? { version } : {}) }, data: { ...data, ...bump(ctx) } })).count > 0;
  }
  exists(ctx: BusinessContext, id: string) { return db(ctx).menuItem.findFirst({ where: { id, tenantId: ctx.business.id, deletedAt: null }, select: { id: true } }); }
  /** The menu items of this branch's menu among these ids (prices come from here). */
  forBill(ctx: BusinessContext, branchId: string, ids: string[]) {
    return db(ctx).menuItem.findMany({ where: { tenantId: ctx.business.id, deletedAt: null, OR: [{ branchId: null }, { branchId }], id: { in: ids } } });
  }
  one(ctx: BusinessContext, id: string) { return db(ctx).menuItem.findFirst({ where: { id, tenantId: ctx.business.id, deletedAt: null, ...this.onMenu(ctx) } }); }
}

// ───── Shifts (tills) ─────
export class ShiftRepository {
  open(ctx: BusinessContext, branchId: string) { return db(ctx).shift.findFirst({ where: { tenantId: ctx.business.id, branchId, closedAt: null }, orderBy: { openedAt: "desc" } }); }
  start(ctx: BusinessContext, branchId: string, float: number) { return db(ctx).shift.create({ data: { tenantId: ctx.business.id, branchId, openedBy: ctx.member.userId, float } }); }
  /** Closes a shift only if it is still open (two closes at once: one wins). */
  async close(ctx: BusinessContext, id: string, counted: number, diff: number): Promise<boolean> {
    return (await db(ctx).shift.updateMany({ where: { id, tenantId: ctx.business.id, closedAt: null }, data: { closedAt: new Date(), closedBy: ctx.member.userId, counted, diff } })).count > 0;
  }
  salesByMethod(ctx: BusinessContext, shiftId: string) { return db(ctx).posBill.groupBy({ by: ["method"], where: { shiftId, status: "paid", deletedAt: null }, _sum: { total: true } }); }
  async cash(ctx: BusinessContext, shiftId: string): Promise<number> {
    return (await db(ctx).posBill.aggregate({ where: { shiftId, status: "paid", method: "cash", deletedAt: null }, _sum: { total: true } }))._sum.total ?? 0;
  }
}

// ───── Bills ─────
export class BillRepository {
  between(ctx: BusinessContext, from: Date, to: Date) {
    return db(ctx).posBill.findMany({ where: { tenantId: ctx.business.id, deletedAt: null, ...inView(ctx), createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "desc" } });
  }
  one(ctx: BusinessContext, id: string) { return db(ctx).posBill.findFirst({ where: { id, tenantId: ctx.business.id, deletedAt: null, ...inView(ctx) } }); }
  create(ctx: BusinessContext, data: Omit<Prisma.PosBillUncheckedCreateInput, "tenantId">) { return db(ctx).posBill.create({ data: { ...data, tenantId: ctx.business.id, ...by(ctx) } }); }
  /** paid -> void, only once. */
  async voidOnce(ctx: BusinessContext, id: string, note: string): Promise<boolean> {
    return (await db(ctx).posBill.updateMany({ where: { id, tenantId: ctx.business.id, status: "paid" }, data: { status: "void", voidNote: note, ...bump(ctx) } })).count > 0;
  }
  /** A guest checked in at this branch (read from the Hotel app). */
  guest(ctx: BusinessContext, id: string, branchId: string) {
    return db(ctx).booking.findFirst({ where: { id, tenantId: ctx.business.id, branchId, status: "checked_in" }, include: { room: true } });
  }
  /** The room-bill line for a POS bill or its void (the agreed exception above). */
  roomLine(ctx: BusinessContext, bookingId: string, what: string, amount: number) {
    return db(ctx).folioLine.create({ data: { bookingId, kind: "pos", what, amount, byUserId: ctx.member.userId } });
  }
}

// ───── Stock ─────
export class StockRepository {
  items(ctx: BusinessContext, more: Prisma.StockItemWhereInput = {}) {
    return db(ctx).stockItem.findMany({ where: { tenantId: ctx.business.id, deletedAt: null, ...inView(ctx), ...more }, orderBy: [{ place: "asc" }, { name: "asc" }] });
  }
  item(ctx: BusinessContext, id: string) { return db(ctx).stockItem.findFirst({ where: { id, tenantId: ctx.business.id, deletedAt: null, ...inView(ctx) } }); }
  /** The same name in the same place at a branch (case does not matter), optionally other than one item. */
  same(ctx: BusinessContext, branchId: string, place: string, name: string, except?: string) {
    return db(ctx).stockItem.findFirst({ where: { tenantId: ctx.business.id, branchId, place, name: { equals: name, mode: "insensitive" }, ...(except ? { id: { not: except } } : {}) } });
  }
  atBranch(ctx: BusinessContext, branchId: string) { return db(ctx).stockItem.findMany({ where: { tenantId: ctx.business.id, branchId } }); }
  add(ctx: BusinessContext, d: { branchId: string; name: string; place: string; unit: string; min: number; cost: number }) { return db(ctx).stockItem.create({ data: { ...d, tenantId: ctx.business.id, ...by(ctx) } }); }
  async change(ctx: BusinessContext, id: string, data: Prisma.StockItemUpdateManyMutationInput, version?: number): Promise<boolean> {
    return (await db(ctx).stockItem.updateMany({ where: { id, tenantId: ctx.business.id, deletedAt: null, ...(version !== undefined ? { version } : {}) }, data: { ...data, ...bump(ctx) } })).count > 0;
  }
  moves(ctx: BusinessContext, where: Prisma.StockMoveWhereInput, take: number, cursor?: string) {
    return db(ctx).stockMove.findMany({ where: { tenantId: ctx.business.id, ...inView(ctx), ...where }, include: { item: { select: { name: true, unit: true, place: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  }
  userNames(ctx: BusinessContext, ids: string[]) { return db(ctx).user.findMany({ where: { id: { in: ids } }, select: { id: true, userName: true } }); }
  recipes(ctx: BusinessContext, menuIds: string[]) {
    return db(ctx).stockRecipe.findMany({ where: { tenantId: ctx.business.id, menuItemId: { in: menuIds }, item: { is: { ...inView(ctx) } } }, include: { item: true } });
  }
  activeItems(ctx: BusinessContext, ids: string[]) { return db(ctx).stockItem.findMany({ where: { tenantId: ctx.business.id, active: true, deletedAt: null, id: { in: ids }, ...inView(ctx) }, select: { id: true } }); }
  /** Replaces the recipe lines of a menu item that use stock in view. */
  async setRecipe(ctx: BusinessContext, menuItemId: string, lines: { itemId: string; qty: number }[]) {
    await db(ctx).stockRecipe.deleteMany({ where: { tenantId: ctx.business.id, menuItemId, item: { is: { ...inView(ctx) } } } });
    if (lines.length) await db(ctx).stockRecipe.createMany({ data: lines.map((l) => ({ tenantId: ctx.business.id, menuItemId, itemId: l.itemId, qty: l.qty })) });
  }
}
