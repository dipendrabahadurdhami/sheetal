// Add-ons: extra seats, listings, featured slots and POS outlets a business on a paid plan buys on top of its plan.
// Where it fits: the admin API sets the prices (Admin → Add-ons); the business API sells them (Business → Billing);
// limits everywhere (team seats, listing room) read effectiveLimits().
// How it works: the catalog is the "addons" app setting (defaults below). Buying makes an "addon" invoice for the rest
// of the paid period (whole months, at least one); once it is paid the quantity counts. Every renewal invoice of the
// plan then includes the add-ons the business keeps (renewQty), so they renew with the plan. Removing one takes effect
// at the next renewal. Moving to Starter ends them.
// Rules: paid plans only; an add-on isn't sold when the plan's limit is already unlimited (-1); whole rupees, VAT
// included like plan prices.

import type { Prisma } from "@prisma/client";
import type { Db } from "../lib/db.js";
import type { BusinessType } from "./permissions.js";

type Tx = Db | Prisma.TransactionClient;
export interface Addon { id: string; name: string; sub: string; unit: string; price: number; limitKey: string; step: number; types: BusinessType[]; active: boolean }
export const ADDON_DEFAULTS: Addon[] = [
  { id: "seats", name: "Extra team seat", sub: "One more person on the team", unit: "seat", price: 300, limitKey: "seats", step: 1, types: ["hotel", "host", "developer", "agency", "sponsor"], active: true },
  { id: "listings", name: "Extra listings", sub: "25 more listings", unit: "pack of 25", price: 500, limitKey: "listings", step: 25, types: ["agency"], active: true },
  { id: "featured", name: "Extra featured slots", sub: "2 more featured listings on the website", unit: "pack of 2", price: 400, limitKey: "featured", step: 2, types: ["hotel", "host", "developer", "agency", "sponsor"], active: true },
  { id: "outlets", name: "Extra POS outlet", sub: "One more restaurant, bar or shop till", unit: "outlet", price: 1500, limitKey: "outlets", step: 1, types: ["hotel", "host"], active: true },
];

/** The catalog as staff set it, over the defaults (an add-on staff never touched keeps its default). */
export async function addonCatalog(db: Tx): Promise<Addon[]> {
  const saved = ((await db.appSetting.findUnique({ where: { key: "addons" } }))?.value ?? {}) as Record<string, Partial<Addon>>;
  return ADDON_DEFAULTS.map((a) => ({ ...a, ...(saved[a.id] ?? {}), id: a.id, limitKey: a.limitKey, step: a.step, unit: a.unit }));
}

/** Whole months left in a paid period (at least one): what an add-on bought now costs for. */
export const monthsLeft = (renewsAt: Date | null, now = new Date()) => (renewsAt && renewsAt > now ? Math.max(1, Math.ceil((renewsAt.getTime() - now.getTime()) / (30 * 864e5))) : 1);

/** Extra limits the business's add-ons give: { seats: 2, listings: 50 }. */
export async function addonExtras(db: Tx, tenantId: string) {
  const [owned, cat] = await Promise.all([db.tenantAddon.findMany({ where: { tenantId, qty: { gt: 0 } } }), addonCatalog(db)]);
  const out: Record<string, number> = {};
  for (const o of owned) { const a = cat.find((x) => x.id === o.addonId); if (a) out[a.limitKey] = (out[a.limitKey] ?? 0) + o.qty * a.step; }
  return out;
}

/** The plan with its limits raised by the add-ons (a limit of -1 stays unlimited; Starter gets none). */
export async function effectiveLimits<P extends { price: number; limits: unknown }>(db: Tx, tenantId: string, plan: P): Promise<P> {
  if (!plan.price) return plan;
  const base = (plan.limits ?? {}) as Record<string, number>;
  const extra = await addonExtras(db, tenantId);
  const limits = { ...base };
  for (const [k, n] of Object.entries(extra)) if (base[k] !== undefined && base[k] !== -1) limits[k] = base[k] + n;
  return { ...plan, limits };
}

export interface AddonLine { id: string; name: string; qty: number; price: number; months: number }
/** The add-on lines a plan renewal includes (what the business keeps), priced now. */
export async function renewalLines(db: Tx, tenantId: string, months: number): Promise<AddonLine[]> {
  const [owned, cat] = await Promise.all([db.tenantAddon.findMany({ where: { tenantId, renewQty: { gt: 0 } } }), addonCatalog(db)]);
  return owned.flatMap((o) => { const a = cat.find((x) => x.id === o.addonId && x.active); return a ? [{ id: a.id, name: a.name, qty: o.renewQty, price: a.price, months }] : []; });
}
export const linesTotal = (lines: AddonLine[]) => lines.reduce((s, l) => s + l.qty * l.price * l.months, 0);

/** Applies a paid invoice: an add-on invoice adds what it bought; a paid plan keeps what the business chose to keep
 *  (renewQty), so an add-on removed earlier ends at the renewal. */
export async function applyAddonLines(tx: Tx, tenantId: string, kind: string, lines: AddonLine[]) {
  if (kind === "addon") {
    for (const l of lines) {
      const cur = await tx.tenantAddon.findUnique({ where: { tenantId_addonId: { tenantId, addonId: l.id } } });
      await tx.tenantAddon.upsert({ where: { tenantId_addonId: { tenantId, addonId: l.id } }, create: { tenantId, addonId: l.id, qty: l.qty, renewQty: l.qty }, update: { qty: (cur?.qty ?? 0) + l.qty, renewQty: (cur?.renewQty ?? 0) + l.qty } });
    }
    return;
  }
  for (const o of await tx.tenantAddon.findMany({ where: { tenantId } })) if (o.qty !== o.renewQty) await tx.tenantAddon.update({ where: { id: o.id }, data: { qty: o.renewQty } });
}

/** Ends every add-on (the business moved to Starter). */
export const endAddons = (tx: Tx, tenantId: string) => tx.tenantAddon.updateMany({ where: { tenantId }, data: { qty: 0, renewQty: 0 } });
