// Stock: what a branch keeps (kitchen, bar, minibar, housekeeping, store), every change to it, and what a sale uses.
// Where it fits: the Stock page and API (business/backend modules/stock/routes.ts) call applyMove(); the point of sale
// calls saleMoves() when a bill is paid and reverseSale() when it is voided; a daily job calls runLowStock().
// How it works: an item's quantity changes only through a move (in, out, waste, sale, count), in one transaction that
// also writes the move row with the balance left. A menu item can have a recipe (what one sale uses); a paid bill takes
// those quantities out, and a voided bill puts back exactly what was taken.
// Rules: whole numbers only; a manual out or waste never takes an item below 0; a count may set any level (0 or more)
// and records the difference; a sale never blocks the bill, it takes what is there (down to 0) and the move shows what
// was really taken, so a void puts back the same; stock in updates the cost to the average of what was bought; days are
// Nepal days (UTC+5:45).

import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import { badRequest, notFound } from "@sheetal/platform/core/errors";
import { teamWith, notify } from "@sheetal/platform/notify/index";
import { nepalDay } from "./payouts.js";

type Tx = Db | Prisma.TransactionClient;

export const STOCK_PLACES = ["kitchen", "bar", "minibar", "housekeeping", "store"] as const;
export type StockPlace = (typeof STOCK_PLACES)[number];
export const MOVE_KINDS = ["in", "out", "sale", "waste", "count"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];
export const MAX_QTY = 100_000_000;
export const MAX_COST = 10_000_000;

/** "Kitchen", " bar " → "kitchen"; anything else → null. */
export const placeOf = (s: unknown): StockPlace | null => {
  const k = String(s ?? "").trim().toLowerCase();
  return (STOCK_PLACES as readonly string[]).includes(k) ? (k as StockPlace) : null;
};

export interface MoveInput {
  tenantId: string;
  itemId: string;
  kind: MoveKind;
  /** in, out, waste, sale: the signed change (+ in, - out). count: the level counted (0 or more). */
  qty: number;
  /** Rs. per unit of what came in (kind "in" only). */
  cost?: number;
  note?: string | null;
  /** The POS bill id (kind "sale"). */
  ref?: string | null;
  userId?: string | null;
  /** Take what is there instead of refusing when there is not enough (sales). */
  clamp?: boolean;
}

/** Changes one item's quantity and writes the move. Call inside a transaction (pass tx) so both stay together. */
export async function applyMove(tx: Tx, m: MoveInput) {
  if (!Number.isInteger(m.qty) || Math.abs(m.qty) > MAX_QTY) throw badRequest("The quantity must be a whole number.");
  if (m.kind === "count" && m.qty < 0) throw badRequest("The count can't be below 0.");
  if (m.kind === "in" && m.qty <= 0) throw badRequest("Stock in must add stock.");
  if ((m.kind === "out" || m.kind === "waste") && m.qty >= 0) throw badRequest("Stock out must take stock away.");
  if (m.kind === "sale" && m.qty === 0) throw badRequest("The quantity can't be 0.");
  const item = await tx.stockItem.findFirst({ where: { id: m.itemId, tenantId: m.tenantId } });
  if (!item) throw notFound("Stock item not found.");

  let delta = m.kind === "count" ? m.qty - item.qty : m.qty;
  if (delta < 0 && item.qty + delta < 0) {
    if (!m.clamp) throw badRequest(`Only ${item.qty} ${item.unit} of ${item.name} in stock.`);
    delta = -item.qty;
  }
  // Atomic: the update only happens if the quantity is still what we read, so two tills can't both take the last one.
  const moved = await tx.stockItem.updateMany({ where: { id: item.id, qty: item.qty }, data: { qty: item.qty + delta } });
  if (!moved.count) throw badRequest("Someone else changed this item just now. Try again.");

  let cost = item.cost;
  if (m.kind === "in" && m.cost !== undefined && m.cost > 0) {
    const total = item.qty + delta;
    cost = Math.round((Math.max(0, item.qty) * item.cost + delta * m.cost) / (total > 0 ? total : 1));
    await tx.stockItem.update({ where: { id: item.id }, data: { cost } });
  }
  const move = await tx.stockMove.create({
    data: { tenantId: item.tenantId, branchId: item.branchId, itemId: item.id, kind: m.kind, qty: delta, after: item.qty + delta, cost: m.kind === "in" ? (m.cost ?? item.cost) : item.cost, note: m.note?.trim().slice(0, 200) || null, ref: m.ref ?? null, userId: m.userId ?? null },
  });
  return { move, item: { ...item, qty: item.qty + delta, cost } };
}

interface BillLine { itemId?: string; qty?: number }

/** What a paid bill uses: the recipe of each menu item sold, as stock items at the bill's branch. */
async function usageOf(tx: Tx, bill: { tenantId: string; branchId: string | null; lines: unknown }) {
  if (!bill.branchId) return new Map<string, number>();
  const sold = new Map<string, number>();
  for (const l of (Array.isArray(bill.lines) ? bill.lines : []) as BillLine[]) {
    if (l && typeof l.itemId === "string" && Number.isInteger(l.qty) && (l.qty ?? 0) > 0) sold.set(l.itemId, (sold.get(l.itemId) ?? 0) + (l.qty as number));
  }
  if (!sold.size) return new Map<string, number>();
  const recipes = await tx.stockRecipe.findMany({ where: { tenantId: bill.tenantId, menuItemId: { in: [...sold.keys()] } }, include: { item: true } });
  const use = new Map<string, number>();
  for (const r of recipes) {
    let itemId: string | null = r.item.branchId === bill.branchId ? r.item.id : null;
    // A shared menu item sold at another branch: that branch's item with the same name and place.
    if (!itemId) itemId = (await tx.stockItem.findFirst({ where: { tenantId: bill.tenantId, branchId: bill.branchId, name: r.item.name, place: r.item.place, active: true }, select: { id: true } }))?.id ?? null;
    if (itemId) use.set(itemId, (use.get(itemId) ?? 0) + r.qty * (sold.get(r.menuItemId) ?? 0));
  }
  return use;
}

/** Takes stock out for a paid bill. Safe to call twice: a bill is taken out once. Never blocks the sale. */
export async function saleMoves(tx: Tx, billId: string, userId?: string | null) {
  const bill = await tx.posBill.findUnique({ where: { id: billId } });
  if (!bill || bill.status !== "paid") return 0;
  if (await tx.stockMove.count({ where: { tenantId: bill.tenantId, kind: "sale", ref: bill.id } })) return 0;
  let n = 0;
  for (const [itemId, qty] of await usageOf(tx, bill)) {
    if (qty <= 0) continue;
    const item = await tx.stockItem.findUnique({ where: { id: itemId }, select: { qty: true } });
    if (!item || item.qty <= 0) continue;
    await applyMove(tx, { tenantId: bill.tenantId, itemId, kind: "sale", qty: -qty, ref: bill.id, userId: userId ?? bill.byUserId, clamp: true, note: `Bill ${billLabel(bill.seq)}` });
    n++;
  }
  return n;
}

/** Puts back what a bill took (it was voided or refunded). Safe to call twice: only what is still out comes back. */
export async function reverseSale(tx: Tx, billId: string, userId?: string | null) {
  const bill = await tx.posBill.findUnique({ where: { id: billId } });
  if (!bill) return 0;
  const moves = await tx.stockMove.groupBy({ by: ["itemId"], where: { tenantId: bill.tenantId, kind: "sale", ref: bill.id }, _sum: { qty: true } });
  let n = 0;
  for (const g of moves) {
    const out = -(g._sum.qty ?? 0);
    if (out <= 0) continue;
    await applyMove(tx, { tenantId: bill.tenantId, itemId: g.itemId, kind: "sale", qty: out, ref: bill.id, userId: userId ?? null, note: `Bill ${billLabel(bill.seq)} voided` });
    n++;
  }
  return n;
}

const billLabel = (seq: number) => `POS-${String(seq).padStart(5, "0")}`;

/** Items below their reorder level (active only; a level of 0 means no alert), emptiest first. */
export async function lowStock(db: Tx, tenantId: string, branchId?: string | string[] | null) {
  const ids = Array.isArray(branchId) ? branchId : branchId ? [branchId] : null;
  const rows = await db.stockItem.findMany({ where: { tenantId, active: true, min: { gt: 0 }, ...(ids ? { branchId: { in: ids } } : {}) }, orderBy: { name: "asc" } });
  return rows.filter((r) => r.qty < r.min).sort((a, b) => a.qty / a.min - b.qty / b.min);
}

/** Once a day per person and branch: tells the people who run stock which items are low. Safe to repeat. */
export async function runLowStock(db: Db, opts: { today?: string } = {}) {
  const day = opts.today ?? nepalDay();
  const since = new Date(`${day}T00:00:00+05:45`);
  if (Number.isNaN(since.getTime())) return { branches: 0, notes: 0 };
  const items = await db.stockItem.findMany({ where: { active: true, min: { gt: 0 }, branch: { status: "open" } }, include: { branch: { select: { name: true } } } });
  const low = items.filter((i) => i.qty < i.min);
  const groups = new Map<string, typeof low>();
  for (const i of low) groups.set(`${i.tenantId}|${i.branchId}`, [...(groups.get(`${i.tenantId}|${i.branchId}`) ?? []), i]);
  let notes = 0;
  for (const [key, list] of groups) {
    const [tenantId, branchId] = key.split("|") as [string, string];
    const link = `/business/stock?low=1&branch=${branchId}`;
    const people = await teamWith(db, tenantId, ["pos.restaurant.use", "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete"], branchId);
    const done = new Set((await db.notification.findMany({ where: { tenantId, type: "stock.low", link, createdAt: { gte: since }, userId: { in: people } }, select: { userId: true } })).map((n) => n.userId));
    const fresh = people.filter((p) => !done.has(p));
    if (!fresh.length) continue;
    const names = list.slice(0, 3).map((i) => i.name).join(", ");
    await notify(db, fresh, { type: "stock.low", tenantId, link, title: `${list.length} stock ${list.length === 1 ? "item is" : "items are"} running low at ${list[0]!.branch.name}`, message: `${names}${list.length > 3 ? ` and ${list.length - 3} more` : ""}.` });
    notes += fresh.length;
  }
  return { branches: groups.size, notes };
}
