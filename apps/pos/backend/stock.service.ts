// The rules of Stock (restaurants, bars, minibars, housekeeping): items, stock in, out and waste, counts, history, recipes, CSV, and the low-stock list, on
// the kernel. Moved from business/backend/src/modules/stock/routes.ts (P2-W4); every rule and message unchanged.
// Where it fits: StockController calls one method per route. The point of sale takes stock out when a bill is paid and puts it back on a void (pos.service.ts).
// How it works: every item belongs to one branch and is counted in whole units. The quantity changes only through a move (in, out, waste, sale, count)
// written by applyMove() (backend-core domain/stock.ts). A recipe says what one sale of a menu item uses. Each change runs in ONE transaction with its audit
// line (the old strings) and its event.
// Rules: view with pos.restaurant, pos.extras or the business settings permissions; change with pos.restaurant or the settings permissions; everything is
// limited to the branches the person works at; stock never goes below 0 by hand; the CSV uses the same columns as the sample's import and export
// (Item, Place, Unit, In stock, Reorder at, Cost (Rs.)).

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { badRequest, conflict, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { MAX_COST, MAX_QTY, STOCK_PLACES, applyMove, lowStock, placeOf } from "@sheetal/backend-core/domain/stock";
import { PosBase, SETTINGS, canAny, need } from "./common.js";
import { MenuRepository, StockRepository, db, viewIds } from "./repositories.js";

const VIEW = ["pos.restaurant.use", "pos.extra.create", SETTINGS];
const CHANGE = ["pos.restaurant.use", SETTINGS];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const whole = (max: number) => z.number().int().min(0).max(max);
const dayStart = (d: string) => { const t = new Date(`${d}T00:00:00+05:45`); if (Number.isNaN(t.getTime())) throw badRequest("That date isn't valid."); return t; };
// A cell that starts with = + - @ would run as a formula in Excel, so it gets a leading quote mark.
const cell = (v: unknown) => { let x = v == null ? "" : String(v); if (/^[=+@-]/.test(x) && Number.isNaN(Number(x))) x = `'${x}`; return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
type Item = { id: string; branchId: string; name: string; place: string; unit: string; qty: number; min: number; cost: number; active: boolean; version: number };
const row = (i: Item, branch: string) => ({ id: i.id, branchId: i.branchId, branch, name: i.name, place: i.place, unit: i.unit, qty: i.qty, min: i.min, cost: i.cost, active: i.active, low: i.active && i.min > 0 && i.qty < i.min, value: i.qty * i.cost, version: i.version });
const names = (ctx: BusinessContext) => new Map(ctx.branches.mine.map((b) => [b.id, b.name]));

const ItemBody = z.object({ name: z.string().trim().min(1).max(80), place: z.enum(STOCK_PLACES), unit: z.string().trim().min(1).max(20), qty: whole(MAX_QTY).default(0), min: whole(MAX_QTY).default(0), cost: whole(MAX_COST).default(0), branchId: z.string().max(40).nullish() });
const ItemEdit = z.object({ name: z.string().trim().min(1).max(80).optional(), place: z.enum(STOCK_PLACES).optional(), unit: z.string().trim().min(1).max(20).optional(), min: whole(MAX_QTY).optional(), cost: whole(MAX_COST).optional(), active: z.boolean().optional(), version: z.number().int().min(1).optional() });

export class StockService extends PosBase {
  readonly stock = new StockRepository();
  readonly menu = new MenuRepository();
  constructor(deps: { bus: EventBus }) { super("stock", deps.bus); }

  private async itemOf(ctx: BusinessContext, id: string) {
    const it = await this.stock.item(ctx, id);
    if (!it) throw notFound("Stock item not found.");
    return it;
  }
  private live(it: { active: boolean }) { if (!it.active) throw badRequest("This item is archived. Restore it first."); }
  /** One stock move with its audit line and event (the quantity changes only here, through applyMove). */
  private move(ctx: BusinessContext, m: Parameters<typeof applyMove>[1], audit: (r: Awaited<ReturnType<typeof applyMove>>) => { action: string; target: string }, branchId: string) {
    return this.write(ctx, (tx) => applyMove(db(tx), m), (r) => ({ audit: audit(r), event: { name: "pos.stock.moved", payload: { itemId: m.itemId, kind: m.kind, qty: r.move.qty, after: r.item.qty }, branchId } }));
  }

  // ───── Items ─────
  async overview(ctx: BusinessContext, rawQuery: unknown) {
    need(ctx, ...VIEW);
    const q = z.object({ place: z.string().max(20).optional(), low: z.string().optional(), q: z.string().max(80).optional(), archived: z.string().optional() }).parse(rawQuery);
    const n = names(ctx);
    const all = (await this.stock.items(ctx)).map((i) => row(i, n.get(i.branchId) ?? ""));
    const active = all.filter((i) => i.active);
    const needle = q.q?.trim().toLowerCase();
    const items = all.filter((i) => (q.archived === "1" ? !i.active : i.active) && (!q.place || i.place === q.place) && (q.low !== "1" || i.low) && (!needle || i.name.toLowerCase().includes(needle)));
    return {
      items, canManage: canAny(ctx, CHANGE), places: STOCK_PLACES,
      branches: ctx.branches.mine.filter((b) => b.status === "open").map((b) => ({ id: b.id, name: b.name })),
      summary: { items: active.length, low: active.filter((i) => i.low).length, value: active.reduce((s, i) => s + i.value, 0), places: new Set(active.map((i) => i.place)).size, archived: all.length - active.length, lowNames: active.filter((i) => i.low).slice(0, 2).map((i) => i.name) },
    };
  }

  async add(ctx: BusinessContext, raw: unknown) {
    need(ctx, ...CHANGE);
    const b = ItemBody.parse(raw);
    const branchId = ctx.branches.branchForNew(b.branchId);
    const dup = await this.stock.same(ctx, branchId, b.place, b.name);
    if (dup) throw badRequest(`${dup.name} is already in ${cap(b.place)} at this branch.${dup.active ? "" : " It is archived: restore it."}`);
    const item = await this.write(ctx, async (tx) => {
      const it = await this.stock.add(tx, { branchId, name: b.name, place: b.place, unit: b.unit, min: b.min, cost: b.cost });
      if (b.qty > 0) await applyMove(db(tx), { tenantId: tx.business.id, itemId: it.id, kind: "in", qty: b.qty, cost: b.cost, note: "Opening stock", userId: tx.member.userId });
      return it;
    }, (it) => ({ audit: { action: "stock.item.added", target: `${it.name} (${it.place}), ${b.qty} ${it.unit}` }, event: { name: "pos.stock.added", payload: { id: it.id, qty: b.qty }, branchId } }));
    return { message: "Stock item saved.", data: { id: item.id } };
  }

  async edit(ctx: BusinessContext, id: string, raw: unknown) {
    need(ctx, ...CHANGE);
    const { version, ...b } = ItemEdit.parse(raw);
    const it = await this.itemOf(ctx, id);
    const name = b.name ?? it.name, place = b.place ?? it.place;
    if (name !== it.name || place !== it.place) {
      const dup = await this.stock.same(ctx, it.branchId, place, name, it.id);
      if (dup) throw badRequest(`${dup.name} is already in ${cap(place)} at this branch.`);
    }
    const action = b.active === false ? "stock.item.archived" : b.active === true && !it.active ? "stock.item.restored" : "stock.item.changed";
    await this.write(ctx, async (tx) => { if (!(await this.stock.change(tx, it.id, b, version))) throw conflict("Someone else changed this item. Reload to see the latest."); return it; },
      () => ({ audit: { action, target: `${it.name} (${it.place})` }, event: { name: "pos.stock.updated", payload: { id: it.id, active: b.active ?? it.active }, branchId: it.branchId } }));
    return { message: b.active === false ? "Item archived." : b.active === true && !it.active ? "Item restored." : "Saved." };
  }

  // ───── Stock in, out, waste, count ─────
  async stockIn(ctx: BusinessContext, id: string, raw: unknown) {
    need(ctx, ...CHANGE);
    const b = z.object({ qty: whole(MAX_QTY).min(1), cost: whole(MAX_COST).optional(), supplier: z.string().trim().max(80).optional(), note: z.string().trim().max(160).optional() }).parse(raw);
    const it = await this.itemOf(ctx, id); this.live(it);
    const note = [b.supplier ? `From ${b.supplier}` : "", b.note ?? ""].filter(Boolean).join(". ") || null;
    const r = await this.move(ctx, { tenantId: ctx.business.id, itemId: it.id, kind: "in", qty: b.qty, cost: b.cost, note, userId: ctx.member.userId },
      () => ({ action: "stock.in", target: `${it.name} +${b.qty} ${it.unit}${b.cost ? ` at Rs. ${b.cost}` : ""}${b.supplier ? ` from ${b.supplier}` : ""}` }), it.branchId);
    return { message: `${b.qty} ${it.unit} added. ${r.item.qty} in stock.`, data: { qty: r.item.qty } };
  }
  async stockOut(ctx: BusinessContext, id: string, raw: unknown) {
    need(ctx, ...CHANGE);
    const b = z.object({ qty: whole(MAX_QTY).min(1), kind: z.enum(["out", "waste"]).default("out"), note: z.string().trim().max(160).optional() }).parse(raw);
    if (b.kind === "waste" && (b.note?.length ?? 0) < 3) throw badRequest("Say what happened to the waste.");
    const it = await this.itemOf(ctx, id); this.live(it);
    const r = await this.move(ctx, { tenantId: ctx.business.id, itemId: it.id, kind: b.kind, qty: -b.qty, note: b.note || null, userId: ctx.member.userId },
      () => ({ action: `stock.${b.kind}`, target: `${it.name} -${b.qty} ${it.unit}${b.note ? `: ${b.note}` : ""}` }), it.branchId);
    return { message: `${b.qty} ${it.unit} taken out. ${r.item.qty} left.`, data: { qty: r.item.qty } };
  }
  async count(ctx: BusinessContext, id: string, raw: unknown) {
    need(ctx, ...CHANGE);
    const b = z.object({ counted: whole(MAX_QTY), note: z.string().trim().max(160).optional() }).parse(raw);
    const it = await this.itemOf(ctx, id); this.live(it);
    const r = await this.move(ctx, { tenantId: ctx.business.id, itemId: it.id, kind: "count", qty: b.counted, note: b.note || null, userId: ctx.member.userId },
      (x) => ({ action: "stock.count", target: `${it.name}: counted ${b.counted} ${it.unit}, difference ${x.move.qty > 0 ? "+" : ""}${x.move.qty}` }), it.branchId);
    const diff = r.move.qty;
    return { message: diff === 0 ? "Counted. It matches." : `Counted. ${Math.abs(diff)} ${it.unit} ${diff > 0 ? "more" : "fewer"} than the books.`, data: { qty: r.item.qty, diff } };
  }

  // ───── History, CSV ─────
  async history(ctx: BusinessContext, rawQuery: unknown) {
    need(ctx, ...VIEW);
    const q = z.object({ itemId: z.string().max(40).optional(), kind: z.enum(["in", "out", "sale", "waste", "count"]).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.coerce.number().int().min(1).max(300).default(100), cursor: z.string().max(40).optional() }).parse(rawQuery);
    const when: Prisma.DateTimeFilter = {};
    if (q.from) when.gte = dayStart(q.from);
    if (q.to) when.lt = new Date(dayStart(q.to).getTime() + 864e5);
    const rows = await this.stock.moves(ctx, { ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(q.from || q.to ? { createdAt: when } : {}) }, q.limit + 1, q.cursor);
    const page = rows.slice(0, q.limit);
    const uids = [...new Set(page.map((m) => m.userId).filter(Boolean))] as string[];
    const users = new Map((await this.stock.userNames(ctx, uids)).map((u) => [u.id, u.userName]));
    const n = names(ctx);
    return { rows: page.map((m) => ({ id: m.id, at: m.createdAt, kind: m.kind, qty: m.qty, after: m.after, cost: m.cost, note: m.note, ref: m.ref, item: m.item.name, unit: m.item.unit, place: m.item.place, branch: n.get(m.branchId) ?? "", by: m.userId ? users.get(m.userId) ?? "" : "" })), next: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async csv(ctx: BusinessContext): Promise<{ name: string; body: string }> {
    need(ctx, ...VIEW);
    const items = await this.stock.items(ctx, { active: true });
    const body = [["Item", "Place", "Unit", "In stock", "Reorder at", "Cost (Rs.)"], ...items.map((i) => [i.name, cap(i.place), i.unit, i.qty, i.min, i.cost])].map((r) => r.map(cell).join(",")).join("\r\n");
    return { name: `stock-${nepalDay()}.csv`, body: `﻿${body}` };
  }

  async importRows(ctx: BusinessContext, raw: unknown) {
    need(ctx, ...CHANGE);
    const b = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000), branchId: z.string().max(40).nullish() }).parse(raw);
    const branchId = ctx.branches.branchForNew(b.branchId);
    const num = (v: unknown, max: number) => { const n = v === "" || v == null ? 0 : Number(v); return Number.isInteger(n) && n >= 0 && n <= max ? n : null; };
    const errors: string[] = [], clean: { name: string; place: string; unit: string; qty: number; min: number; cost: number; key: string }[] = [], seen = new Set<string>();
    b.rows.forEach((r, i) => {
      const n = i + 1, name = String(r.name ?? "").trim(), unit = String(r.unit ?? "").trim(), place = placeOf(r.place), qty = num(r.qty, MAX_QTY), min = num(r.min, MAX_QTY), cost = num(r.cost, MAX_COST);
      if (!name || name.length > 80) errors.push(`Row ${n}: the item name is missing or too long.`);
      else if (!place) errors.push(`Row ${n}: place must be ${STOCK_PLACES.map(cap).join(", ")}.`);
      else if (!unit || unit.length > 20) errors.push(`Row ${n}: the unit is missing.`);
      else if (qty === null || min === null || cost === null) errors.push(`Row ${n}: In stock, Reorder at and Cost must be whole numbers.`);
      else if (seen.has(`${name.toLowerCase()}|${place}`)) errors.push(`Row ${n}: ${name} is in the file twice for ${cap(place)}.`);
      else { seen.add(`${name.toLowerCase()}|${place}`); clean.push({ name, place, unit, qty, min, cost, key: `${name.toLowerCase()}|${place}` }); }
    });
    if (errors.length) throw badRequest(`${errors.slice(0, 5).join(" ")}${errors.length > 5 ? ` And ${errors.length - 5} more.` : ""} Nothing was imported.`);
    const have = new Map((await this.stock.atBranch(ctx, branchId)).map((i) => [`${i.name.toLowerCase()}|${i.place}`, i]));
    const r = await this.write(ctx, async (tx) => {
      let added = 0, updated = 0;
      for (const c of clean) {
        const x = have.get(c.key);
        if (x) {
          await this.stock.change(tx, x.id, { unit: c.unit, active: true, ...(c.min ? { min: c.min } : {}), ...(c.cost ? { cost: c.cost } : {}) });
          if (c.qty !== x.qty) await applyMove(db(tx), { tenantId: tx.business.id, itemId: x.id, kind: "count", qty: c.qty, note: "Import", userId: tx.member.userId });
          updated++;
        } else {
          const it = await this.stock.add(tx, { branchId, name: c.name, place: c.place, unit: c.unit, min: c.min, cost: c.cost });
          if (c.qty > 0) await applyMove(db(tx), { tenantId: tx.business.id, itemId: it.id, kind: "in", qty: c.qty, cost: c.cost, note: "Imported", userId: tx.member.userId });
          added++;
        }
      }
      return { added, updated };
    }, (x) => ({ audit: { action: "stock.import", target: `${x.added} added, ${x.updated} updated` }, event: { name: "pos.stock.imported", payload: x, branchId } }));
    return { message: `${r.added} added, ${r.updated} updated.` };
  }

  // ───── Recipes: what one sale of a menu item uses ─────
  async recipes(ctx: BusinessContext) {
    need(ctx, ...VIEW);
    const menu = await this.menu.list(ctx, { active: true });
    const recipes = await this.stock.recipes(ctx, menu.map((m) => m.id));
    return { canManage: canAny(ctx, CHANGE), menu: menu.map((m) => ({ id: m.id, name: m.name, outlet: m.outlet, category: m.category, lines: recipes.filter((r) => r.menuItemId === m.id).map((r) => ({ itemId: r.itemId, name: r.item.name, place: r.item.place, unit: r.item.unit, qty: r.qty })) })) };
  }

  async setRecipe(ctx: BusinessContext, menuItemId: string, raw: unknown) {
    need(ctx, ...CHANGE);
    const b = z.object({ lines: z.array(z.object({ itemId: z.string().max(40), qty: whole(MAX_QTY).min(1) })).max(30) }).parse(raw);
    const menu = await this.menu.one(ctx, menuItemId);
    if (!menu) throw notFound("Menu item not found.");
    if (new Set(b.lines.map((l) => l.itemId)).size !== b.lines.length) throw badRequest("An item is in the recipe twice.");
    if ((await this.stock.activeItems(ctx, b.lines.map((l) => l.itemId))).length !== b.lines.length) throw badRequest("Pick stock items that are active at your branch.");
    await this.write(ctx, (tx) => this.stock.setRecipe(tx, menu.id, b.lines),
      () => ({ audit: { action: "stock.recipe", target: `${menu.name}: ${b.lines.length} item${b.lines.length === 1 ? "" : "s"}` }, event: { name: "pos.recipe.saved", payload: { menuItemId: menu.id, lines: b.lines.length }, branchId: menu.branchId } }));
    return { message: b.lines.length ? "Recipe saved." : "Recipe cleared." };
  }

  /** Low items at the picked branches, for the bell and the POS. */
  async low(ctx: BusinessContext) {
    need(ctx, ...VIEW);
    const ids = viewIds(ctx);
    return (await lowStock(db(ctx), ctx.business.id, ids ? [...ids] : null)).map((i) => ({ id: i.id, name: i.name, place: i.place, qty: i.qty, min: i.min, unit: i.unit }));
  }
}
