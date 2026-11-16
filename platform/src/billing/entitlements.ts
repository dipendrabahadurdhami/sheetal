// Entitlements v3: what a business may use, built from its app subscriptions, staff/migration grants and add-ons (MARKETPLACE-AND-BILLING.md
// sections 6 and 7). Today's builder (buildEntitlements in tenancy/context.ts, "v1", from the Starter / Business / Pro plan) stays for
// businesses on billingMode "plans"; this one is used for "apps", and both run side by side for "shadow" (shadow.ts).
// Where it fits: tenancy/context.ts picks the builder by Tenant.billingMode; BaseService calls requireWrite() on every write and
// requireLimit() before adding one more; GET /entitlements shows the same answers to the screens.
// How it works (MB 6.2): access(app) from effectiveStatus (dates decide); edition = the trial or paid edition, "free" after a fall-back;
// limit = the larger of the edition's value, active grants and add-on extras (null = unlimited wins); feature = an edition in full/limited
// access lists it, or it is a business paid feature and any paid edition is in full access, or a grant gives it; seats = the larger of the
// free seats and the biggest paid edition's seats, plus seat add-ons and seat grants. The workspace (core) app is always full.
// Rules: pure (the loader passes the rows in). Never lowers anything: a grant or an add-on only raises. The refusals use the error bodies of
// MB 6.3 (402 limit_reached, 402 subscription_read_only) so one front-end panel handles every app.

import { AppError } from "../core/errors.js";
import type { Entitlements } from "../core/context.js";
import { effectiveStatus, type EffectiveStatus } from "./effective-status.js";
import { checkLimit, largerLimit } from "./limits.js";
import type { AccessMode, BillingSettings, Catalog, SubscriptionState } from "./types.js";

export interface GrantState { kind: string; appId: string | null; key: string | null; value: number | null; startsAt: Date; endsAt: Date | null; revokedAt: Date | null }
export interface AddonState { appId: string; addonKey: string; qty: number; currentPeriodEnd: Date }

export interface EntitlementsV3Input {
  now: Date;
  catalog: Catalog;
  settings: Pick<BillingSettings, "graceDays" | "readOnlyDays">;
  subscriptions: SubscriptionState[];
  grants: GrantState[];
  addons: AddonState[];
  seatsUsed: number;
  /** Apps that are always on (kind "core": the workspace). */
  coreApps?: readonly string[];
  /** The business's AI state (own key, Sheetal AI or locked), worked out by the loader (platform/src/ai/router.ts aiStateQuick). */
  ai?: "locked" | "own_key" | "sheetal";
}

export type EntitlementsV3 = Required<Pick<Entitlements, "access" | "requireWrite" | "requireLimit">> & Entitlements & {
  /** Every app's status, for GET /entitlements and the shadow comparison. */
  statuses(): Record<string, EffectiveStatus>;
};

const live = (g: GrantState, now: Date) => !g.revokedAt && g.startsAt <= now && (!g.endsAt || now < g.endsAt);

export function buildEntitlementsV3(o: EntitlementsV3Input): EntitlementsV3 {
  const core = new Set(o.coreApps ?? ["workspace"]);
  const grants = o.grants.filter((g) => live(g, o.now));
  const addons = o.addons.filter((a) => a.qty > 0 && o.now < a.currentPeriodEnd);
  const status = new Map<string, EffectiveStatus>();
  for (const s of o.subscriptions) {
    const app = o.catalog.apps[s.appId];
    status.set(s.appId, effectiveStatus(s, o.now, { freeEditionEnabled: app?.freeEditionEnabled ?? false, settings: o.settings }));
  }
  // A staff or migration grant of a whole app gives full access to its edition (key = the edition, default "full").
  for (const g of grants) if (g.kind === "app" && g.appId) {
    const cur = status.get(g.appId);
    if (!cur || cur.access !== "full") status.set(g.appId, { status: "active", access: "full", edition: g.key ?? "full", until: g.endsAt });
  }

  const access = (appId: string): AccessMode => (core.has(appId) ? "full" : status.get(appId)?.access ?? "none");
  const edition = (appId: string): string | null => (core.has(appId) ? "default" : status.get(appId)?.edition ?? null);
  const editionOf = (appId: string) => {
    const ed = edition(appId);
    return ed ? o.catalog.apps[appId]?.editions[ed] : undefined;
  };
  const isPaidFull = (appId: string) => access(appId) === "full" && !!editionOf(appId) && !editionOf(appId)!.free;

  const limit = (appId: string, key: string): number | null => {
    let v: number | null | undefined = access(appId) === "none" || access(appId) === "locked" ? 0 : editionOf(appId)?.limits[key]?.value;
    for (const g of grants) if (g.kind === "limit" && g.appId === appId && g.key === key) v = largerLimit(v, g.value);
    if (v != null) for (const a of addons) {
      const def = o.catalog.addons.find((d) => d.key === a.addonKey && d.appId === appId && d.limitKey === key);
      if (def) v += a.qty * def.step;
    }
    return v === undefined ? null : v; // a key no edition names is not limited (as v1)
  };

  const feature = (key: string): boolean => {
    for (const appId of status.keys()) {
      const a = access(appId);
      if ((a === "full" || a === "limited") && editionOf(appId)?.features.includes(key)) return true;
    }
    if (o.catalog.business.paidFeatures.includes(key) && [...status.keys()].some(isPaidFull)) return true;
    return grants.some((g) => g.kind === "feature" && g.key === key);
  };

  const seats = () => {
    let lim: number | null = o.catalog.business.freeSeats;
    // largerLimit gives null for unlimited and undefined only when neither side has a value (never here: lim starts as a number).
    const raise = (v: number | null | undefined) => { const r = largerLimit(lim, v); if (r !== undefined) lim = r; };
    for (const appId of status.keys()) if (isPaidFull(appId)) raise(editionOf(appId)!.limits.seats?.value);
    for (const g of grants) if (g.kind === "seats") raise(g.value);
    if (lim !== null) for (const a of addons) if (a.addonKey === "seats" && !a.appId) lim += a.qty;
    return { used: o.seatsUsed, limit: lim };
  };

  const appName = (appId: string) => o.catalog.apps[appId]?.name?.en ?? appId;

  return {
    mode: "apps",
    hasApp: (appId) => { const a = access(appId); return a === "full" || a === "limited" || a === "read_only"; },
    edition,
    limit,
    feature,
    seats,
    // The same state for every app's AI features: AI is a business-level product (MB 10.2). Absent = locked.
    ai: () => o.ai ?? "locked",
    access,
    statuses: () => Object.fromEntries(status),
    requireWrite(appId) {
      const a = access(appId);
      if (a === "full" || a === "limited") return;
      const name = appName(appId);
      if (a === "none") throw new AppError(403, "app_not_available", `Your business doesn't have ${name}.`, undefined, { appId, marketplace: true });
      throw new AppError(402, "subscription_read_only",
        a === "read_only" ? `Your ${name} subscription has ended: you can still see, print and export everything. Renew to make changes.`
          : `Your subscription for ${name} is paused. Renew to open it again. Your data is safe.`,
        undefined, { appId, access: a });
    },
    requireLimit(appId, key, u) {
      const adding = u.adding ?? 1;
      const value = limit(appId, key);
      const ed = editionOf(appId);
      const decl = ed?.limits[key];
      const ans = checkLimit({ value, behaviour: decl?.behaviour ?? "hard", softOverPct: decl?.softOverPct }, u.used, adding);
      if (ans.refused) {
        // The cheapest edition that would allow it, for the upgrade panel.
        const better = Object.entries(o.catalog.apps[appId]?.editions ?? {})
          .filter(([, e]) => !e.free && (e.limits[key]?.value == null || e.limits[key]!.value! >= u.used + adding))
          .sort(([, a], [, b]) => a.priceMonthPaisa - b.priceMonthPaisa)[0];
        throw new AppError(402, "limit_reached", `Your ${ed?.name.en ?? ""} ${appName(appId)} has room for ${value} and ${u.used} are used.`.replace(/\s+/g, " "), undefined, {
          appId, key, limit: value, used: u.used, behaviour: decl?.behaviour ?? "hard", tryEdition: better?.[0] ?? null, tryPricePaisa: better?.[1].priceMonthPaisa ?? null,
        });
      }
      return { warn: ans.warn, over: ans.over };
    },
  };
}
