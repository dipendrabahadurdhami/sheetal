// Today's plan (Starter / Business / Pro) as app subscriptions and grants: rules R1 to R4 and R6 of MARKETPLACE-AND-BILLING.md section 8.1.
// Where it fits: the entitlement parity test (P3-BE-3) proves v3 built from this mapping answers at least what v1 answers; the migration
// script (P3-BE-10) writes exactly these rows, plus dates, prices, add-ons, AI credits and the price lock (R5, R7 to R11).
// How it works: pure. R1 every app v1 says the business has (its type, or all types on a plan with all_kinds); R2 the edition is "full" on a
// paid plan (pos and agreements need their old feature switch), "free" on Starter; R3 an old limit higher than the new edition's becomes a
// grant until lockEnd (-1 = unlimited); R4 the old seats become a seat grant; R6 the paid features come with any paid edition (catalog
// paidFeatures), all_kinds is replaced by R1.
// Rules: never lowers anything; the old key -> new key table is MB section 8.2.

import type { AppManifest, BusinessType } from "../core/manifest.js";
import type { Catalog } from "./types.js";

export interface OldPlan { price: number; limits: Record<string, number>; features: Record<string, boolean> }

/** MB 8.2: an old limit key -> the app and key it becomes. `units` depends on the business type. */
export function newKeyOf(type: string, oldKey: string): { appId: string; key: string } | null {
  switch (oldKey) {
    case "rooms": return { appId: "hotel", key: "rooms" };
    case "units": return type === "host" ? { appId: "hotel", key: "rooms" } : type === "developer" ? { appId: "projects", key: "units" } : null;
    case "projects": return { appId: "projects", key: "projects" };
    case "listings": return { appId: "listings", key: "listings" };
    case "stays": return { appId: "listings", key: "stays" };
    case "investments": return { appId: "investments", key: "open_investments" };
    case "outlets": return { appId: "pos", key: "outlets" };
    case "featured": return { appId: "promote", key: "featured_slots" };
    default: return null; // seats are business-level (R4)
  }
}

/** Old feature switches that decide an app's edition (R2). */
const GATES: Record<string, string> = { pos: "pos", agreements: "agreements" };

export interface MappedSubscription { appId: string; editionId: string }
export interface MappedGrant { kind: "limit" | "seats"; appId: string | null; key: string | null; value: number | null }

export function mapPlanToApps(o: { type: string; plan: OldPlan; manifests: readonly Pick<AppManifest, "id" | "kind" | "businessTypes">[]; catalog: Catalog }): { subscriptions: MappedSubscription[]; grants: MappedGrant[] } {
  const paid = o.plan.price > 0;
  const f = o.plan.features ?? {};
  const allKinds = !!f.all_kinds;
  const subscriptions: MappedSubscription[] = [];
  for (const m of o.manifests) {
    if (m.kind !== "app") continue;
    const offered = m.businessTypes === "all" || allKinds || (m.businessTypes as readonly BusinessType[]).includes(o.type as BusinessType);
    if (!offered) continue;
    const gate = GATES[m.id];
    const full = paid && (!gate || !!f[gate]) && !!o.catalog.apps[m.id]?.editions.full;
    subscriptions.push({ appId: m.id, editionId: full ? "full" : "free" });
  }
  // Featured slots move to the Promote app: a plan that had any gets Promote too.
  if ((o.plan.limits.featured ?? 0) !== 0 && o.catalog.apps.promote) subscriptions.push({ appId: "promote", editionId: paid ? "full" : "free" });

  const grants: MappedGrant[] = [];
  const has = new Map(subscriptions.map((s) => [s.appId, s.editionId]));
  for (const [oldKey, raw] of Object.entries(o.plan.limits ?? {})) {
    if (oldKey === "seats") continue;
    const to = newKeyOf(o.type, oldKey);
    if (!to || !has.has(to.appId)) continue;
    const old = raw < 0 ? null : raw;
    const edLimit = o.catalog.apps[to.appId]?.editions[has.get(to.appId)!]?.limits[to.key]?.value;
    const covered = edLimit === null || (edLimit !== undefined && old !== null && edLimit >= old);
    if (!covered) grants.push({ kind: "limit", appId: to.appId, key: to.key, value: old });
  }
  const seats = o.plan.limits.seats;
  if (seats !== undefined && (seats < 0 || seats > o.catalog.business.freeSeats)) grants.push({ kind: "seats", appId: null, key: null, value: seats < 0 ? null : seats });
  return { subscriptions, grants };
}
