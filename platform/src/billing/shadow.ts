// Shadow mode (MARKETPLACE-AND-BILLING.md section 8.6): for a business on billingMode "shadow" both builders run; the old (v1, plans) answer
// is used and every place where the new (v3, apps) answer differs is written down. Seven days with no "less" differences is a launch gate (G4).
// Where it fits: tenancy/context.ts builds both for shadow businesses and calls compareEntitlements(); the differences go to the log and,
// at most once an hour per business, to one AuditLog row ("billing.shadow_diff") that Admin -> Billing counts (P3-BE-7).
// How it works: the questions asked are the ones v1 can answer: has each app; each old limit key under its new name (MB 8.2); the old
// feature switches under their new names; the seat limit. "less" = v3 gives less than v1 (a business would lose something: must be zero);
// "more" = v3 gives more (expected where the new editions are more generous; listed so they are seen).
// Rules: pure except recordShadow(), which never throws (shadow mode must never break a request).

import type { Entitlements } from "../core/context.js";
import { newKeyOf } from "./mapping.js";

export interface ShadowDiff { kind: "less" | "more"; what: string; v1: unknown; v3: unknown }

/** Old feature switch -> how v3 says the same thing. */
const FEATURE_PROBES: Record<string, (e: Entitlements) => boolean> = {
  custom_roles: (e) => e.feature("custom_roles"),
  multi_property: (e) => e.feature("multi_property"),
  api: (e) => e.feature("api.access"),
  channel_sync: (e) => e.feature("hotel.channel_sync"),
  pos: (e) => e.edition("pos") === "full",
  agreements: (e) => e.edition("agreements") === "full",
};

const rank = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);

export function compareEntitlements(o: { type: string; appIds: readonly string[]; oldLimits: Record<string, number>; oldFeatures: Record<string, boolean>; v1: Entitlements; v3: Entitlements }): ShadowDiff[] {
  const out: ShadowDiff[] = [];
  for (const id of o.appIds) {
    const a = o.v1.hasApp(id), b = o.v3.hasApp(id);
    if (a !== b) out.push({ kind: a ? "less" : "more", what: `app ${id}`, v1: a, v3: b });
  }
  for (const oldKey of Object.keys(o.oldLimits)) {
    if (oldKey === "seats") continue;
    const to = newKeyOf(o.type, oldKey);
    if (!to || !o.v1.hasApp(to.appId) && to.appId !== "promote") continue;
    const a = o.v1.limit(to.appId, oldKey), b = o.v3.limit(to.appId, to.key);
    if (rank(a) !== rank(b)) out.push({ kind: rank(b) < rank(a) ? "less" : "more", what: `limit ${oldKey} -> ${to.appId}.${to.key}`, v1: a, v3: b });
  }
  for (const [f, probe] of Object.entries(FEATURE_PROBES)) {
    const a = !!o.oldFeatures[f], b = probe(o.v3);
    if (a !== b) out.push({ kind: a ? "less" : "more", what: `feature ${f}`, v1: a, v3: b });
  }
  const sa = o.v1.seats().limit, sb = o.v3.seats().limit;
  if (rank(sa) !== rank(sb)) out.push({ kind: rank(sb) < rank(sa) ? "less" : "more", what: "seats", v1: sa, v3: sb });
  return out;
}

const lastWritten = new Map<string, number>();
const HOUR = 3_600_000;

/** Logs the differences; writes one audit row per business per hour at most. Never throws. */
export async function recordShadow(o: { db: { auditLog: { create(a: { data: object }): Promise<unknown> } }; log: { warn(obj: object, msg?: string): void }; tenantId: string; diffs: ShadowDiff[]; now: Date }): Promise<void> {
  if (!o.diffs.length) return;
  try {
    o.log.warn({ tenantId: o.tenantId, shadowDiffs: o.diffs }, "billing shadow: the app subscriptions answer differently from the plan");
    const last = lastWritten.get(o.tenantId) ?? 0;
    if (o.now.getTime() - last < HOUR) return;
    lastWritten.set(o.tenantId, o.now.getTime());
    const less = o.diffs.filter((d) => d.kind === "less").length;
    await o.db.auditLog.create({ data: { actorId: null, tenantId: o.tenantId, action: "billing.shadow_diff", target: `${less} less, ${o.diffs.length - less} more`, meta: { diffs: o.diffs } as object } });
  } catch (e) {
    o.log.warn({ err: e, tenantId: o.tenantId }, "billing shadow: could not record the differences");
  }
}
