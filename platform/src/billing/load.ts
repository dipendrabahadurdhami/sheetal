// Loads what entitlements v3 needs for one business and picks the builder by Tenant.billingMode (MB sections 6.2 and 8.6).
// Where it fits: tenancy/context.ts (requests) and tenancy/system-context.ts (jobs) call entitlementsFor(); GET /entitlements uses the same.
// How it works: "plans" (the default, every business today) returns the v1 answer and runs no extra query. "apps" loads the business's
// subscriptions, live grants and add-ons (three small queries) and the catalog and billing settings (cached 30 s by the settings store)
// and returns v3. "shadow" returns v1 and, in the background of the same request, builds v3, compares and records the differences.
// Rules: a shadow failure never changes or breaks the request; the v1 answer always wins in shadow.

import type { FastifyBaseLogger } from "fastify";
import type { Entitlements } from "../core/context.js";
import type { Db } from "../db/client.js";
import { SettingsService } from "../settings/service.js";
import { APPS } from "../tenancy/apps.generated.js";
import { BILLING_SETTING, CATALOG_SETTING, withNewApps } from "./catalog.js";
import { buildEntitlementsV3, type EntitlementsV3 } from "./entitlements.js";
import { compareEntitlements, recordShadow } from "./shadow.js";
import type { SubscriptionStatus } from "./types.js";

export type BillingMode = "plans" | "shadow" | "apps";
export const modeOf = (v: unknown): BillingMode => (v === "apps" || v === "shadow" ? v : "plans");

const stores = new WeakMap<object, SettingsService>();
const storeFor = (db: Db, log: FastifyBaseLogger) => {
  let s = stores.get(db);
  if (!s) { s = new SettingsService(db as never, log); stores.set(db, s); }
  return s;
};

const n = (v: bigint | number | null | undefined) => (v == null ? 0 : Number(v));

/** v3 for one business, from the database. */
export async function loadEntitlementsV3(db: Db, log: FastifyBaseLogger, tenantId: string, now: Date, seatsUsed: number): Promise<EntitlementsV3> {
  const store = storeFor(db, log);
  const [subs, grants, addons, catalog, settings] = await Promise.all([
    db.subscription.findMany({ where: { tenantId } }),
    db.entitlementGrant.findMany({ where: { tenantId, revokedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } }),
    db.addonSubscription.findMany({ where: { tenantId, qty: { gt: 0 } } }),
    store.get(CATALOG_SETTING),
    store.get(BILLING_SETTING),
  ]);
  return buildEntitlementsV3({
    now, catalog: withNewApps(catalog), settings, seatsUsed,
    coreApps: APPS.filter((a) => a.kind === "core").map((a) => a.id),
    subscriptions: subs.map((s) => ({
      appId: s.appId, editionId: s.editionId, status: s.status as SubscriptionStatus, periodMonths: s.periodMonths, priceGrossPaisa: n(s.priceGrossPaisa),
      currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, trialUsedAt: s.trialUsedAt,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd, uninstalledAt: s.uninstalledAt,
    })),
    grants: grants.map((g) => ({ kind: g.kind, appId: g.appId, key: g.key, value: g.value, startsAt: g.startsAt, endsAt: g.endsAt, revokedAt: g.revokedAt })),
    addons: addons.map((a) => ({ appId: a.appId, addonKey: a.addonKey, qty: a.qty, currentPeriodEnd: a.currentPeriodEnd })),
  });
}

/** The entitlements a request or a job uses, by the business's billing mode. `v1` is today's answer, built by the caller. */
export async function entitlementsFor(o: {
  db: Db; log: FastifyBaseLogger; now: Date; tenant: { id: string; type: string; billingMode?: unknown }; seatsUsed: number;
  v1: Entitlements; oldLimits: unknown; oldFeatures: unknown;
}): Promise<Entitlements> {
  const mode = modeOf(o.tenant.billingMode);
  if (mode === "plans") return o.v1;
  if (mode === "apps") return loadEntitlementsV3(o.db, o.log, o.tenant.id, o.now, o.seatsUsed);
  // Shadow: answer with v1 now; compare in the background.
  void (async () => {
    try {
      const v3 = await loadEntitlementsV3(o.db, o.log, o.tenant.id, o.now, o.seatsUsed);
      const diffs = compareEntitlements({
        type: o.tenant.type, appIds: APPS.filter((a) => a.kind === "app").map((a) => a.id),
        oldLimits: (o.oldLimits ?? {}) as Record<string, number>, oldFeatures: (o.oldFeatures ?? {}) as Record<string, boolean>, v1: o.v1, v3,
      });
      await recordShadow({ db: o.db, log: o.log, tenantId: o.tenant.id, diffs, now: o.now });
    } catch (e) {
      o.log.warn({ err: e, tenantId: o.tenant.id }, "billing shadow: could not build the app answer");
    }
  })();
  return { ...o.v1, mode: "shadow" };
}
