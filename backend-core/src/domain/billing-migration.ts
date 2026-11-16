// Moving businesses from Starter / Business / Pro to app subscriptions (MARKETPLACE-AND-BILLING.md section 8; P3-BE-10): the database side.
// Where it fits: backend-core/scripts/migrate-plans-to-apps.ts is the command line (dry run, apply, restore, price report); the tests call
// these functions directly. The rules and the proofs that need no database are in platform/src/billing/migrate-plan.ts (pure).
// How it works:
//   loadBusiness()  reads one business as it is today: plan, limits with add-ons (effectiveLimits, what v1 enforces), add-ons with today's
//                   prices, dates, status, usage counts, open plan invoices, payments in flight, monthly AI credits, the paying business of
//                   a covered one.
//   dryRun()        plans every business (or the --business ones) and returns the plans. Writes nothing.
//   apply()         one BillingMigrationRun row, then ONE transaction per business: write the planned rows stamped with the run id, then
//                   P5 (row counts and the plan columns unchanged) and P6 (paid invoices unchanged), all-or-nothing per business.
//                   A business that already has app subscriptions is skipped (P7: never written twice). Any FAIL: nothing is written.
//   restore()       removes the rows of one apply run (the last by default) and puts billingMode back to "plans"; refuses a business that
//                   bought anything on the new system unless `force`.
// Rules: billingMode is NOT changed by apply (step 1 of MB 8.6: rows exist, nothing reads them). Plan, renewsAt, period, status: never
// touched (R11). Paid invoices: never touched. Open plan invoices: listed for the switch to "apps", not voided here.

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import { SettingsService } from "@sheetal/platform/settings/service";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import { BILLING_SETTING, CATALOG_SETTING, withNewApps } from "@sheetal/platform/billing/catalog";
import { maskName, plan, passed, type MigrationBusiness, type MigrationPlan } from "@sheetal/platform/billing/migrate-plan";
import type { BillingSettings, Catalog } from "@sheetal/platform/billing/types";
import { addonCatalog, effectiveLimits } from "./addons.js";
import { aiFeatureSettings } from "./ai-features.js";
import { priceFor } from "./plans.js";

type Tx = Prisma.TransactionClient;
const quiet = { warn: () => undefined };

/** Usage the script can count, by "appId.key": table, and whether it counts the last 31 days (a "per month" limit) or every live row. */
export const USAGE_COUNTERS: Readonly<Record<string, { table: string; monthly: boolean }>> = {
  "hotel.rooms": { table: "rooms", monthly: false },
  "listings.listings": { table: "listings", monthly: false },
  "crm.leads": { table: "leads", monthly: false },
  "projects.units": { table: "units", monthly: false },
  "rentals.leases": { table: "rent_leases", monthly: false },
  "collections.bookings": { table: "collections", monthly: false },
  "expenses.recurring_templates": { table: "recurring_expenses", monthly: false },
  "pos.bills_per_month": { table: "pos_bills", monthly: true },
  "invoicing.invoices_per_month": { table: "biz_invoices", monthly: true },
  "expenses.expenses_per_month": { table: "expenses", monthly: true },
  "reviews.reviews_per_month": { table: "reviews", monthly: true },
  "agreements.agreements_per_month": { table: "agreements", monthly: true },
};

/** P5: rows that must be exactly as many after the move as before (per business). */
export const DATA_TABLES = ["listings", "rooms", "bookings", "leads", "invoices", "payments", "biz_invoices", "biz_receipts", "memberships"] as const;

const DAY = 864e5;

async function count(db: Db | Tx, table: string, tenantId: string, since?: Date): Promise<number> {
  const hasDeleted = !["invoices", "payments", "memberships"].includes(table);
  const sql = `SELECT count(*)::int AS n FROM "${table}" WHERE tenant_id = $1${hasDeleted ? " AND deleted_at IS NULL" : ""}${since ? " AND created_at >= $2" : ""}`;
  const r = await db.$queryRawUnsafe<{ n: number }[]>(sql, ...(since ? [tenantId, since] : [tenantId]));
  return r[0]?.n ?? 0;
}

export interface MigrationEnv { catalog: Catalog; settings: BillingSettings; now: Date }

/** The catalog and billing settings the servers use (or a catalog file given with --catalog). */
export async function migrationEnv(db: Db, o: { now?: Date; catalog?: Catalog } = {}): Promise<MigrationEnv> {
  const store = new SettingsService(db as never, quiet);
  return { catalog: o.catalog ?? withNewApps(await store.get(CATALOG_SETTING)), settings: await store.get(BILLING_SETTING), now: o.now ?? new Date() };
}

export async function loadBusiness(db: Db | Tx, tenantId: string, now: Date): Promise<{ b: MigrationBusiness; usedApps: string[]; migrated: boolean } | null> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  if (!t) return null;
  const [eff, owned, cat, ai, open, inFlight, parent, subs] = await Promise.all([
    effectiveLimits(db, t.id, t.plan),
    db.tenantAddon.findMany({ where: { tenantId: t.id }, orderBy: { addonId: "asc" } }),
    addonCatalog(db),
    aiFeatureSettings(db as Db),
    db.invoice.findMany({ where: { tenantId: t.id, status: "open", kind: { in: ["plan", "addon"] } }, select: { id: true, kind: true }, orderBy: { seq: "asc" } }),
    db.payment.count({ where: { tenantId: t.id, status: { in: ["initiated", "pending_review"] }, invoice: { kind: { in: ["plan", "addon"] } } } }),
    t.coveredById ? db.tenant.findUnique({ where: { id: t.coveredById }, select: { renewsAt: true } }) : Promise.resolve(null),
    db.subscription.count({ where: { tenantId: t.id } }),
  ]);
  const usage: Record<string, number> = {};
  const usedApps = new Set<string>();
  const monthAgo = new Date(now.getTime() - 31 * DAY), quarterAgo = new Date(now.getTime() - 90 * DAY);
  for (const [k, c] of Object.entries(USAGE_COUNTERS)) {
    usage[k] = await count(db, c.table, t.id, c.monthly ? monthAgo : undefined);
    if (await count(db, c.table, t.id, quarterAgo)) usedApps.add(k.split(".")[0]!);
  }
  const months = t.period;
  const addons = owned.map((o) => ({ id: o.addonId, qty: o.qty, renewQty: o.renewQty, priceMonth: cat.find((a) => a.id === o.addonId)?.price ?? null }));
  const plan = { id: t.plan.id, name: t.plan.name, price: t.plan.price, limits: (t.plan.limits ?? {}) as Record<string, number>, features: (t.plan.features ?? {}) as Record<string, boolean> };
  const oldRenewalRupees = t.plan.price > 0 && !t.coveredById ? priceFor(t.plan.price, months) + addons.reduce((a, x) => a + x.renewQty * (x.priceMonth ?? 0) * months, 0) : 0;
  return {
    migrated: subs > 0,
    usedApps: [...usedApps],
    b: {
      id: t.id, name: t.name, type: t.type, status: t.status, demo: t.demo, period: t.period, renewsAt: t.renewsAt, graceUntil: t.graceUntil, coveredById: t.coveredById,
      plan, limits: (eff.limits ?? {}) as Record<string, number>, addons, oldRenewalRupees, usage,
      aiCreditsMonthly: ai.plans[t.plan.name]?.credits ?? 0, openInvoices: open, paymentsInFlight: inFlight, parentRenewsAt: parent?.renewsAt ?? null,
    },
  };
}

export interface BusinessResult { plan: MigrationPlan; usedApps: string[]; written?: boolean; error?: string }

async function tenantIds(db: Db, only?: string[]): Promise<string[]> {
  if (only?.length) return only;
  return (await db.tenant.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })).map((t) => t.id);
}

/** Plans every business; writes nothing. */
export async function dryRun(db: Db, env: MigrationEnv, only?: string[]): Promise<BusinessResult[]> {
  const out: BusinessResult[] = [];
  for (const id of await tenantIds(db, only)) {
    const l = await loadBusiness(db, id, env.now);
    if (!l) { out.push({ usedApps: [], plan: { kind: "skip", id, masked: `?? (${id})`, reason: "no such business" } }); continue; }
    if (l.migrated) { out.push({ usedApps: l.usedApps, plan: { kind: "skip", id, masked: maskName(l.b.name, id), reason: "already has app subscriptions (P7: nothing to write)" } }); continue; }
    out.push({ usedApps: l.usedApps, plan: plan({ b: l.b, now: env.now, catalog: env.catalog, settings: env.settings, manifests: APPS, usedApps: l.usedApps }) });
  }
  return out;
}

const snapshot = async (tx: Tx, tenantId: string) => {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { planId: true, renewsAt: true, period: true, status: true, graceUntil: true, billingMode: true } });
  const counts: Record<string, number> = {};
  for (const table of DATA_TABLES) counts[table] = await count(tx, table, tenantId);
  const paid = await tx.invoice.findMany({ where: { tenantId, status: "paid" }, select: { id: true, total: true, paidAt: true }, orderBy: { id: "asc" } });
  return { tenant: JSON.stringify(t), counts, paid: JSON.stringify(paid) };
};

class ProofFailed extends Error {}

/** Writes one planned business inside `tx` and proves P5 and P6 there. Throws ProofFailed (and so rolls back) on any difference. */
async function writeOne(tx: Tx, p: Extract<MigrationPlan, { kind: "write" }>, runId: string, now: Date): Promise<void> {
  const before = await snapshot(tx, p.id);
  if (await tx.subscription.count({ where: { tenantId: p.id } })) throw new ProofFailed("P7: the business already has app subscriptions");
  for (const s of p.subscriptions) {
    const sub = await tx.subscription.create({ data: {
      id: randomUUID(), tenantId: p.id, appId: s.appId, editionId: s.editionId, status: s.status, periodMonths: s.periodMonths,
      priceGrossPaisa: BigInt(s.priceGrossPaisa), listPriceGrossPaisa: BigInt(s.listPriceGrossPaisa), currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, trialUsedAt: s.trialUsedAt, graceUntil: s.graceUntil, source: s.source,
      installedAt: now, migrationRunId: runId,
    } });
    await tx.subscriptionEvent.create({ data: { subscriptionId: sub.id, tenantId: p.id, appId: s.appId, type: "migrated", toStatus: s.status, toEdition: s.editionId, actorKind: "migration", reason: `run ${runId}`, at: now } });
  }
  for (const g of p.grants) {
    await tx.entitlementGrant.create({ data: { id: randomUUID(), tenantId: p.id, kind: g.kind, appId: g.appId, key: g.key, value: g.value, source: g.source, reason: g.reason, startsAt: g.startsAt, endsAt: g.endsAt, createdBy: "migration", migrationRunId: runId } });
  }
  for (const a of p.addons) {
    await tx.addonSubscription.create({ data: { id: randomUUID(), tenantId: p.id, appId: a.appId, addonKey: a.addonKey, qty: a.qty, renewQty: a.renewQty, unitPriceGrossPaisa: BigInt(a.unitPriceGrossPaisa), periodMonths: a.periodMonths, currentPeriodEnd: a.currentPeriodEnd, source: "migration", migrationRunId: runId } });
  }
  if (p.lock) {
    await tx.billingLock.create({ data: { tenantId: p.id, legacyMonthlyGrossPaisa: BigInt(p.lock.legacyMonthlyGrossPaisa), legacyPeriodMonths: p.lock.legacyPeriodMonths, coversApps: p.lock.coversApps, lockEnd: p.lock.lockEnd, migrationRunId: runId } });
  }
  await tx.auditLog.create({ data: { actorId: null, tenantId: p.id, action: "billing.migrated", target: runId, meta: { subscriptions: p.subscriptions.length, grants: p.grants.length, lockEnd: p.lockEnd.toISOString() } } });

  const after = await snapshot(tx, p.id);
  const changed = DATA_TABLES.filter((t) => before.counts[t] !== after.counts[t]);
  if (changed.length) throw new ProofFailed(`P5: row counts changed (${changed.join(", ")})`);
  if (before.tenant !== after.tenant) throw new ProofFailed("P5: the plan, dates or status of the business changed");
  if (before.paid !== after.paid) throw new ProofFailed("P6: a paid invoice changed");
}

export interface ApplyResult { runId: string; results: BusinessResult[]; ok: boolean }

/** Plans, proves and writes. A business with any FAIL is not written; the others are (each all-or-nothing). */
export async function apply(db: Db, env: MigrationEnv, o: { only?: string[]; by?: string } = {}): Promise<ApplyResult> {
  const plans = await dryRun(db, env, o.only);
  const run = await db.billingMigrationRun.create({ data: { id: randomUUID(), mode: "apply", createdBy: o.by ?? "script", startedAt: env.now } });
  for (const r of plans) {
    if (r.plan.kind !== "write" || !passed(r.plan)) continue;
    const p = r.plan;
    try {
      await db.$transaction((tx) => writeOne(tx, p, run.id, env.now), { timeout: 60_000, maxWait: 20_000 });
      r.written = true;
    } catch (e) {
      r.error = e instanceof ProofFailed ? e.message : `could not write: ${(e as Error).message}`;
    }
  }
  const ok = plans.every((r) => r.plan.kind === "skip" || (passed(r.plan) && r.written));
  await db.billingMigrationRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), report: summary(plans) as unknown as Prisma.InputJsonValue } });
  return { runId: run.id, results: plans, ok };
}

export function summary(results: BusinessResult[]) {
  return {
    planned: results.filter((r) => r.plan.kind === "write").length,
    passed: results.filter((r) => passed(r.plan)).length,
    written: results.filter((r) => r.written).length,
    skipped: results.filter((r) => r.plan.kind === "skip").map((r) => ({ id: r.plan.id, reason: r.plan.kind === "skip" ? r.plan.reason : "" })),
    failed: results.filter((r) => (r.plan.kind === "write" && !passed(r.plan)) || r.error).map((r) => ({ id: r.plan.id, error: r.error ?? (r.plan.kind === "write" ? r.plan.proofs.filter((x) => !x.ok).map((x) => `${x.id}: ${x.detail}`).join("; ") : "") })),
  };
}

export interface RestoreResult { runId: string | null; restored: string[]; refused: { id: string; reason: string }[] }

/** Removes the rows one apply run made (the last one when no id is given) and puts billingMode back to "plans". */
export async function restore(db: Db, o: { runId?: string; only?: string[]; force?: boolean; by?: string; now?: Date } = {}): Promise<RestoreResult> {
  const run = o.runId
    ? await db.billingMigrationRun.findUnique({ where: { id: o.runId } })
    : await db.billingMigrationRun.findFirst({ where: { mode: "apply" }, orderBy: { startedAt: "desc" } });
  if (!run || run.mode !== "apply") return { runId: null, restored: [], refused: [] };
  const tenants = [...new Set((await db.subscription.findMany({ where: { migrationRunId: run.id }, select: { tenantId: true } })).map((s) => s.tenantId))]
    .filter((id) => !o.only?.length || o.only.includes(id));
  const out: RestoreResult = { runId: run.id, restored: [], refused: [] };
  for (const tenantId of tenants) {
    // A business that bought or paid anything on the new system keeps it (MB 8.6: fix forward instead).
    const sold = await db.invoice.count({ where: { tenantId, kind: "subscription", status: "paid" } })
      + await db.subscription.count({ where: { tenantId, migrationRunId: null } });
    if (sold && !o.force) { out.refused.push({ id: tenantId, reason: "has a sale or an app on the new system (use --force to remove the migration rows anyway)" }); continue; }
    await db.$transaction(async (tx) => {
      await tx.subscription.deleteMany({ where: { tenantId, migrationRunId: run.id } });
      await tx.addonSubscription.deleteMany({ where: { tenantId, migrationRunId: run.id } });
      await tx.billingLock.deleteMany({ where: { tenantId, migrationRunId: run.id } });
      // Credits the job already added from this run's monthly AI grants go too (their ref names the grant).
      const aiGrants = await tx.entitlementGrant.findMany({ where: { tenantId, migrationRunId: run.id, kind: "ai_credits_monthly" }, select: { id: true } });
      for (const g of aiGrants) await tx.aiCreditGrant.deleteMany({ where: { tenantId, ref: { startsWith: `migrated-ai:${g.id}:` } } });
      await tx.entitlementGrant.deleteMany({ where: { tenantId, migrationRunId: run.id } });
      await tx.tenant.update({ where: { id: tenantId }, data: { billingMode: "plans" } });
      await tx.auditLog.create({ data: { actorId: null, tenantId, action: "billing.migration_restored", target: run.id } });
    });
    out.restored.push(tenantId);
  }
  await db.billingMigrationRun.create({ data: { id: randomUUID(), mode: "restore", createdBy: o.by ?? "script", startedAt: o.now ?? new Date(), finishedAt: new Date(), report: { from: run.id, restored: out.restored, refused: out.refused } as unknown as Prisma.InputJsonValue } });
  return out;
}

/** The price report (MB 8.5): one row per paying business, rupees with paisa. */
export function priceReportCsv(results: BusinessResult[]): string {
  const rs = (p: number) => (p / 100).toFixed(2);
  const lines = ["business,period_months,old_monthly,protected_renewal,after_lock_all_apps,after_lock_used_apps,change_pct"];
  for (const r of results) {
    if (r.plan.kind !== "write" || !r.plan.price) continue;
    const x = r.plan.price;
    const oldPeriod = x.oldMonthlyPaisa * x.periodMonths;
    const pct = oldPeriod ? (((x.afterLockRenewalPaisa - oldPeriod) / oldPeriod) * 100).toFixed(1) : "";
    lines.push([`"${r.plan.masked.replace(/"/g, "'")}"`, x.periodMonths, rs(x.oldMonthlyPaisa), rs(x.protectedRenewalPaisa), rs(x.afterLockRenewalPaisa), rs(x.usedOnlyRenewalPaisa), pct].join(","));
  }
  return lines.join("\n") + "\n";
}
