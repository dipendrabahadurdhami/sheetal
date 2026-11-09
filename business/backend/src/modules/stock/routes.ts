// Stock for restaurants, bars, minibars and housekeeping: items, stock in, out and waste, counts, history, recipes, CSV.
// Where it fits: the panel's Stock page (Business → Stock, paid). The point of sale takes stock out when a bill is paid
// and puts it back when the bill is voided (domain/stock.ts saleMoves and reverseSale, called from modules/pos/routes.ts).
// How it works: every item belongs to one branch and is counted in whole units. The quantity changes only through a
// move (in, out, waste, sale, count) written by applyMove(). A recipe says what one sale of a menu item uses. A daily
// job tells the people who run stock which items are low (once a day per person and branch).
// Rules: view with pos.restaurant, pos.extras or settings.business; change with pos.restaurant or settings.business;
// everything is limited to the branches the person works at; stock never goes below 0 by hand; every change is written
// to the audit log; the CSV uses the same columns as the sample's import and export (Item, Place, Unit, In stock,
// Reorder at, Cost (Rs.)).

import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { MAX_COST, MAX_QTY, STOCK_PLACES, applyMove, lowStock, placeOf, runLowStock } from "@sheetal/backend-core/domain/stock";
import { branchFor, branchView, inView, workspaceOf, type BranchView, type Workspace } from "../access.js";

const VIEW = ["pos.restaurant", "pos.extras", "settings.business"];
const CHANGE = ["pos.restaurant", "settings.business"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const whole = (max: number) => z.number().int().min(0).max(max);
const dayStart = (d: string) => {
  const t = new Date(`${d}T00:00:00+05:45`);
  if (Number.isNaN(t.getTime())) throw badRequest("That date isn't valid.");
  return t;
};
// A cell that starts with = + - @ would run as a formula in Excel, so it gets a leading quote mark.
const cell = (v: unknown) => { let x = v == null ? "" : String(v); if (/^[=+@-]/.test(x) && Number.isNaN(Number(x))) x = `'${x}`; return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };

export async function stockRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const need = (ws: Workspace, perms: string[]) => { if (!perms.some(ws.can)) throw forbidden("Your role can't do this."); };
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action, target, ip } });
  /** An item in this person's branches. */
  const itemOf = async (ws: Workspace, v: BranchView, id: string) => {
    const it = await db().stockItem.findFirst({ where: { id, tenantId: ws.tenantId, ...inView(v) } });
    if (!it) throw notFound("Stock item not found.");
    return it;
  };
  const live = (it: { active: boolean }) => { if (!it.active) throw badRequest("This item is archived. Restore it first."); };
  const row = (i: { id: string; branchId: string; name: string; place: string; unit: string; qty: number; min: number; cost: number; active: boolean }, branch: string) =>
    ({ id: i.id, branchId: i.branchId, branch, name: i.name, place: i.place, unit: i.unit, qty: i.qty, min: i.min, cost: i.cost, active: i.active, low: i.active && i.min > 0 && i.qty < i.min, value: i.qty * i.cost });
  const branchNames = async (v: BranchView) => new Map(v.mine.map((b) => [b.id, b.name]));

  // ───── Items ─────
  app.get("/stock", async (request) => {
    const ws = workspaceOf(request); need(ws, VIEW);
    const q = z.object({ place: z.string().max(20).optional(), low: z.string().optional(), q: z.string().max(80).optional(), archived: z.string().optional() }).parse(request.query);
    const v = await branchView(db(), request, ws);
    const names = await branchNames(v);
    const all = (await db().stockItem.findMany({ where: { tenantId: ws.tenantId, ...inView(v) }, orderBy: [{ place: "asc" }, { name: "asc" }] })).map((i) => row(i, names.get(i.branchId) ?? ""));
    const active = all.filter((i) => i.active);
    const needle = q.q?.trim().toLowerCase();
    const items = all.filter((i) => (q.archived === "1" ? !i.active : i.active) && (!q.place || i.place === q.place) && (q.low !== "1" || i.low) && (!needle || i.name.toLowerCase().includes(needle)));
    return { data: {
      items, canManage: CHANGE.some(ws.can), places: STOCK_PLACES,
      branches: v.mine.filter((b) => b.status === "open").map((b) => ({ id: b.id, name: b.name })),
      summary: { items: active.length, low: active.filter((i) => i.low).length, value: active.reduce((s, i) => s + i.value, 0), places: new Set(active.map((i) => i.place)).size, archived: all.length - active.length, lowNames: active.filter((i) => i.low).slice(0, 2).map((i) => i.name) },
    } };
  });

  const itemBody = z.object({
    name: z.string().trim().min(1).max(80), place: z.enum(STOCK_PLACES), unit: z.string().trim().min(1).max(20),
    qty: whole(MAX_QTY).default(0), min: whole(MAX_QTY).default(0), cost: whole(MAX_COST).default(0), branchId: z.string().max(40).nullish(),
  });

  app.post("/stock", async (request) => {
    const ws = workspaceOf(request); need(ws, CHANGE);
    const b = itemBody.parse(request.body);
    const branchId = branchFor(await branchView(db(), request, ws), b.branchId);
    const dup = await db().stockItem.findFirst({ where: { tenantId: ws.tenantId, branchId, place: b.place, name: { equals: b.name, mode: "insensitive" } } });
    if (dup) throw badRequest(`${dup.name} is already in ${cap(b.place)} at this branch.${dup.active ? "" : " It is archived: restore it."}`);
    const item = await db().$transaction(async (tx) => {
      const it = await tx.stockItem.create({ data: { tenantId: ws.tenantId, branchId, name: b.name, place: b.place, unit: b.unit, min: b.min, cost: b.cost } });
      if (b.qty > 0) await applyMove(tx, { tenantId: ws.tenantId, itemId: it.id, kind: "in", qty: b.qty, cost: b.cost, note: "Opening stock", userId: ws.user.id });
      return it;
    });
    await audit(ws, request.ip, "stock.item.added", `${item.name} (${item.place}), ${b.qty} ${item.unit}`);
    return { message: "Stock item saved.", data: { id: item.id } };
  });

  app.patch<{ Params: { id: string } }>("/stock/:id", async (request) => {
    const ws = workspaceOf(request); need(ws, CHANGE);
    const b = z.object({ name: z.string().trim().min(1).max(80).optional(), place: z.enum(STOCK_PLACES).optional(), unit: z.string().trim().min(1).max(20).optional(), min: whole(MAX_QTY).optional(), cost: whole(MAX_COST).optional(), active: z.boolean().optional() }).parse(request.body);
    const it = await itemOf(ws, await branchView(db(), request, ws), request.params.id);
    const name = b.name ?? it.name, place = b.place ?? it.place;
    if (name !== it.name || place !== it.place) {
      const dup = await db().stockItem.findFirst({ where: { tenantId: ws.tenantId, branchId: it.branchId, place, name: { equals: name, mode: "insensitive" }, id: { not: it.id } } });
      if (dup) throw badRequest(`${dup.name} is already in ${cap(place)} at this branch.`);
    }
    await db().stockItem.update({ where: { id: it.id }, data: b });
    await audit(ws, request.ip, b.active === false ? "stock.item.archived" : b.active === true && !it.active ? "stock.item.restored" : "stock.item.changed", `${it.name} (${it.place})`);
    return { message: b.active === false ? "Item archived." : b.active === true && !it.active ? "Item restored." : "Saved." };
  });

  // ───── Stock in, out, waste, count ─────
  app.post<{ Params: { id: string } }>("/stock/:id/in", async (request) => {
    const ws = workspaceOf(request); need(ws, CHANGE);
    const b = z.object({ qty: whole(MAX_QTY).min(1), cost: whole(MAX_COST).optional(), supplier: z.string().trim().max(80).optional(), note: z.string().trim().max(160).optional() }).parse(request.body);
    const it = await itemOf(ws, await branchView(db(), request, ws), request.params.id); live(it);
    const note = [b.supplier ? `From ${b.supplier}` : "", b.note ?? ""].filter(Boolean).join(". ") || null;
    const r = await db().$transaction((tx) => applyMove(tx, { tenantId: ws.tenantId, itemId: it.id, kind: "in", qty: b.qty, cost: b.cost, note, userId: ws.user.id }));
    await audit(ws, request.ip, "stock.in", `${it.name} +${b.qty} ${it.unit}${b.cost ? ` at Rs. ${b.cost}` : ""}${b.supplier ? ` from ${b.supplier}` : ""}`);
    return { message: `${b.qty} ${it.unit} added. ${r.item.qty} in stock.`, data: { qty: r.item.qty } };
  });

  app.post<{ Params: { id: string } }>("/stock/:id/out", async (request) => {
    const ws = workspaceOf(request); need(ws, CHANGE);
    const b = z.object({ qty: whole(MAX_QTY).min(1), kind: z.enum(["out", "waste"]).default("out"), note: z.string().trim().max(160).optional() }).parse(request.body);
    if (b.kind === "waste" && (b.note?.length ?? 0) < 3) throw badRequest("Say what happened to the waste.");
    const it = await itemOf(ws, await branchView(db(), request, ws), request.params.id); live(it);
    const r = await db().$transaction((tx) => applyMove(tx, { tenantId: ws.tenantId, itemId: it.id, kind: b.kind, qty: -b.qty, note: b.note || null, userId: ws.user.id }));
    await audit(ws, request.ip, `stock.${b.kind}`, `${it.name} -${b.qty} ${it.unit}${b.note ? `: ${b.note}` : ""}`);
    return { message: `${b.qty} ${it.unit} taken out. ${r.item.qty} left.`, data: { qty: r.item.qty } };
  });

  app.post<{ Params: { id: string } }>("/stock/:id/count", async (request) => {
    const ws = workspaceOf(request); need(ws, CHANGE);
    const b = z.object({ counted: whole(MAX_QTY), note: z.string().trim().max(160).optional() }).parse(request.body);
    const it = await itemOf(ws, await branchView(db(), request, ws), request.params.id); live(it);
    const r = await db().$transaction((tx) => applyMove(tx, { tenantId: ws.tenantId, itemId: it.id, kind: "count", qty: b.counted, note: b.note || null, userId: ws.user.id }));
    const diff = r.move.qty;
    await audit(ws, request.ip, "stock.count", `${it.name}: counted ${b.counted} ${it.unit}, difference ${diff > 0 ? "+" : ""}${diff}`);
    return { message: diff === 0 ? "Counted. It matches." : `Counted. ${Math.abs(diff)} ${it.unit} ${diff > 0 ? "more" : "fewer"} than the books.`, data: { qty: r.item.qty, diff } };
  });

  // ───── History ─────
  app.get("/stock/moves", async (request) => {
    const ws = workspaceOf(request); need(ws, VIEW);
    const q = z.object({ itemId: z.string().max(40).optional(), kind: z.enum(["in", "out", "sale", "waste", "count"]).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.coerce.number().int().min(1).max(300).default(100), cursor: z.string().max(40).optional() }).parse(request.query);
    const v = await branchView(db(), request, ws);
    const when: Prisma.DateTimeFilter = {};
    if (q.from) when.gte = dayStart(q.from);
    if (q.to) when.lt = new Date(dayStart(q.to).getTime() + 864e5);
    const rows = await db().stockMove.findMany({
      where: { tenantId: ws.tenantId, ...inView(v), ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(q.from || q.to ? { createdAt: when } : {}) },
      include: { item: { select: { name: true, unit: true, place: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    const users = new Map((await db().user.findMany({ where: { id: { in: [...new Set(page.map((m) => m.userId).filter((x): x is string => !!x))] } }, select: { id: true, userName: true } })).map((u) => [u.id, u.userName]));
    const names = await branchNames(v);
    return { data: { rows: page.map((m) => ({ id: m.id, at: m.createdAt, kind: m.kind, qty: m.qty, after: m.after, cost: m.cost, note: m.note, ref: m.ref, item: m.item.name, unit: m.item.unit, place: m.item.place, branch: names.get(m.branchId) ?? "", by: m.userId ? users.get(m.userId) ?? "" : "" })), next: rows.length > q.limit ? page[page.length - 1]!.id : null } };
  });

  // ───── CSV ─────
  app.get("/stock/export", async (request, reply) => {
    const ws = workspaceOf(request); need(ws, VIEW);
    const items = await db().stockItem.findMany({ where: { tenantId: ws.tenantId, active: true, ...inView(await branchView(db(), request, ws)) }, orderBy: [{ place: "asc" }, { name: "asc" }] });
    const body = [["Item", "Place", "Unit", "In stock", "Reorder at", "Cost (Rs.)"], ...items.map((i) => [i.name, cap(i.place), i.unit, i.qty, i.min, i.cost])].map((r) => r.map(cell).join(",")).join("\r\n");
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="stock-${nepalDay()}.csv"`).send(`\uFEFF${body}`);
  });

  app.post("/stock/import", async (request) => {
    const ws = workspaceOf(request); need(ws, CHANGE);
    const b = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000), branchId: z.string().max(40).nullish() }).parse(request.body);
    const branchId = branchFor(await branchView(db(), request, ws), b.branchId);
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
    const have = new Map((await db().stockItem.findMany({ where: { tenantId: ws.tenantId, branchId } })).map((i) => [`${i.name.toLowerCase()}|${i.place}`, i]));
    let added = 0, updated = 0;
    await db().$transaction(async (tx) => {
      for (const r of clean) {
        const x = have.get(r.key);
        if (x) {
          await tx.stockItem.update({ where: { id: x.id }, data: { unit: r.unit, active: true, ...(r.min ? { min: r.min } : {}), ...(r.cost ? { cost: r.cost } : {}) } });
          if (r.qty !== x.qty) await applyMove(tx, { tenantId: ws.tenantId, itemId: x.id, kind: "count", qty: r.qty, note: "Import", userId: ws.user.id });
          updated++;
        } else {
          const it = await tx.stockItem.create({ data: { tenantId: ws.tenantId, branchId, name: r.name, place: r.place, unit: r.unit, min: r.min, cost: r.cost } });
          if (r.qty > 0) await applyMove(tx, { tenantId: ws.tenantId, itemId: it.id, kind: "in", qty: r.qty, cost: r.cost, note: "Imported", userId: ws.user.id });
          added++;
        }
      }
    });
    await audit(ws, request.ip, "stock.import", `${added} added, ${updated} updated`);
    return { message: `${added} added, ${updated} updated.` };
  });

  // ───── Recipes: what one sale of a menu item uses ─────
  const onMenu = (v: BranchView): Prisma.MenuItemWhereInput => (v.ids ? { OR: [{ branchId: null }, { branchId: { in: v.ids } }] } : {});

  app.get("/stock/recipes", async (request) => {
    const ws = workspaceOf(request); need(ws, VIEW);
    const v = await branchView(db(), request, ws);
    const menu = await db().menuItem.findMany({ where: { tenantId: ws.tenantId, active: true, ...onMenu(v) }, orderBy: [{ outlet: "asc" }, { category: "asc" }, { name: "asc" }] });
    const recipes = await db().stockRecipe.findMany({ where: { tenantId: ws.tenantId, menuItemId: { in: menu.map((m) => m.id) }, item: { is: { ...inView(v) } } }, include: { item: true } });
    return { data: { canManage: CHANGE.some(ws.can), menu: menu.map((m) => ({ id: m.id, name: m.name, outlet: m.outlet, category: m.category, lines: recipes.filter((r) => r.menuItemId === m.id).map((r) => ({ itemId: r.itemId, name: r.item.name, place: r.item.place, unit: r.item.unit, qty: r.qty })) })) } };
  });

  app.put<{ Params: { menuItemId: string } }>("/stock/recipes/:menuItemId", async (request) => {
    const ws = workspaceOf(request); need(ws, CHANGE);
    const b = z.object({ lines: z.array(z.object({ itemId: z.string().max(40), qty: whole(MAX_QTY).min(1) })).max(30) }).parse(request.body);
    const v = await branchView(db(), request, ws);
    const menu = await db().menuItem.findFirst({ where: { id: request.params.menuItemId, tenantId: ws.tenantId, ...onMenu(v) } });
    if (!menu) throw notFound("Menu item not found.");
    if (new Set(b.lines.map((l) => l.itemId)).size !== b.lines.length) throw badRequest("An item is in the recipe twice.");
    const items = await db().stockItem.findMany({ where: { tenantId: ws.tenantId, active: true, id: { in: b.lines.map((l) => l.itemId) }, ...inView(v) }, select: { id: true } });
    if (items.length !== b.lines.length) throw badRequest("Pick stock items that are active at your branch.");
    await db().$transaction(async (tx) => {
      await tx.stockRecipe.deleteMany({ where: { tenantId: ws.tenantId, menuItemId: menu.id, item: { is: { ...inView(v) } } } });
      if (b.lines.length) await tx.stockRecipe.createMany({ data: b.lines.map((l) => ({ tenantId: ws.tenantId, menuItemId: menu.id, itemId: l.itemId, qty: l.qty })) });
    });
    await audit(ws, request.ip, "stock.recipe", `${menu.name}: ${b.lines.length} item${b.lines.length === 1 ? "" : "s"}`);
    return { message: b.lines.length ? "Recipe saved." : "Recipe cleared." };
  });

  // Low items at the picked branches, for the bell and the POS.
  app.get("/stock/low", async (request) => {
    const ws = workspaceOf(request); need(ws, VIEW);
    const v = await branchView(db(), request, ws);
    const rows = await lowStock(db(), ws.tenantId, v.ids);
    return { data: rows.map((i) => ({ id: i.id, name: i.name, place: i.place, qty: i.qty, min: i.min, unit: i.unit })) };
  });
}

/** Tells the people who run stock which items are low, once a day each (checked every 6 hours; safe to repeat). */
export function startStockJob(app: FastifyInstance) {
  const run = () => runLowStock(dbOf(app), { today: nepalDay() })
    .then((r) => { if (r.notes) app.log.info(r, "low stock"); })
    .catch((e) => app.log.error({ err: e }, "low stock failed"));
  const first = setTimeout(run, 70_000);
  const every = setInterval(run, 6 * 3600_000);
  app.addHook("onClose", async () => { clearTimeout(first); clearInterval(every); });
}
