// The cutover switch (MARKETPLACE-AND-BILLING.md section 8.6; P3-OPS-1): moves a business between the three billing modes
// plans (today's Starter / Business / Pro) -> shadow (both worked out, the old answer used) -> apps (per-app subscriptions), and back.
// Where it fits: backend-core/scripts/billing-mode.ts is the command line (`npm run billing:mode`); the owner's cutover scripts
// (scripts/ops/p3-cutover.ps1) call that. The migration (billing-migration.ts) writes the app rows first and never changes the mode;
// this file is the only code that does.
// How it works:
//   modeStatus()  one row per business: its mode, whether the migration wrote its rows, since when it is on shadow, the differences the
//                 servers recorded since then ("less" = the app answer gave less than the plan: must be zero), its open plan invoices and
//                 payments in flight, whether it bought anything on the new system, and `lessNow`: the same comparison the servers make in
//                 shadow mode, made here and now from the stored rows (so a business nobody opened this week is checked too).
//   checkMove()   the rules, pure: may this business move to that mode? Returns the reason when it may not.
//   setMode()     checks every business, and with `apply` writes: ONE transaction per business = the mode, the open plan and add-on
//                 invoices voided when the target is "apps" (R10: the renewal job makes the new ones), and one audit row
//                 ("billing.mode_changed", target "shadow -> apps"). A refused business is not written; the others are.
// Rules (none can be forced unless it says so):
//   - shadow and apps need the migration rows (a business the migration skipped stays on plans).
//   - apps needs: on shadow first, `minShadowDays` days there (7 for everyone; the pilot passes fewer), zero "less" differences, recorded
//     or now. `force` skips these three only.
//   - a business the migration skipped may still move when staff gave it apps as a live gift (it keeps every app through the gift).
//   - apps is refused while a plan payment is in flight (it must settle first). Never forced.
//   - apps -> plans is refused once the business bought or installed anything on the new system (it would lose it: fix forward). Never forced.
//   - apps -> shadow is refused: go back to plans first.
// Boost and banner invoices and paid invoices are never touched.

import type { Prisma } from "@prisma/client";
import type { Db } from "@sheetal/platform/db/client";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import { buildEntitlements, countSeats } from "@sheetal/platform/tenancy/context";
import { loadEntitlementsV3, modeOf, type BillingMode } from "@sheetal/platform/billing/load";
import { maskName } from "@sheetal/platform/billing/migrate-plan";
import { compareEntitlements, type ShadowDiff } from "@sheetal/platform/billing/shadow";
import { effectiveLimits } from "./addons.js";

const DAY = 864e5;
const quiet = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return quiet; }, level: "silent", silent() {} } as never;

export const MODES = ["plans", "shadow", "apps"] as const;
export const MODE_CHANGED = "billing.mode_changed";

export interface ModeRow {
  id: string; masked: string; mode: BillingMode; status: string;
  /** The migration wrote this business's app rows. */
  migrated: boolean;
  /** Staff gave this business apps as a live gift (every app it used, e.g. Sheetal's own group businesses): it loses nothing on apps either. */
  gifted: boolean;
  /** When it last moved to shadow (from the audit row); null when it never did. */
  shadowSince: Date | null;
  /** Differences the servers recorded since `shadowSince`: reports with at least one "less", and all reports. */
  lessReports: number; reports: number;
  /** The comparison made now from the stored rows: what the app answer gives less than the plan (must be empty). */
  lessNow: string[];
  /** Open plan and add-on invoices (voided when the business moves to apps). */
  openInvoices: string[];
  paymentsInFlight: number;
  /** It paid a subscription invoice or installed an app itself on the new system. */
  sold: boolean;
}

/** The comparison of shadow mode, made now for one business from what is stored. Empty for a business without app rows. */
export async function compareNow(db: Db, tenantId: string, now: Date): Promise<ShadowDiff[]> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  if (!t) return [];
  const [eff, seatsUsed] = await Promise.all([effectiveLimits(db as never, t.id, t.plan), countSeats(db, t.id, now)]);
  const oldLimits = (eff.limits ?? {}) as Record<string, number>, oldFeatures = (t.plan.features ?? {}) as Record<string, boolean>;
  const v1 = buildEntitlements({ type: t.type, plan: { features: oldFeatures }, limits: oldLimits, seatsUsed });
  const v3 = await loadEntitlementsV3(db, quiet, t.id, now, seatsUsed);
  return compareEntitlements({ type: t.type, appIds: APPS.filter((a) => a.kind === "app").map((a) => a.id), oldLimits, oldFeatures, v1, v3 });
}

export async function modeStatus(db: Db, o: { only?: string[]; now?: Date } = {}): Promise<ModeRow[]> {
  const now = o.now ?? new Date();
  const tenants = await db.tenant.findMany({
    where: o.only?.length ? { id: { in: o.only } } : {}, orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true, billingMode: true },
  });
  const out: ModeRow[] = [];
  for (const t of tenants) {
    const mode = modeOf(t.billingMode);
    const [migrated, changes, open, paymentsInFlight, paidNew, ownSubs, gifts] = await Promise.all([
      db.subscription.count({ where: { tenantId: t.id, migrationRunId: { not: null } } }),
      db.auditLog.findMany({ where: { tenantId: t.id, action: MODE_CHANGED }, orderBy: { createdAt: "desc" }, take: 20, select: { target: true, createdAt: true } }),
      db.invoice.findMany({ where: { tenantId: t.id, status: "open", kind: { in: ["plan", "addon"] } }, select: { id: true }, orderBy: { seq: "asc" } }),
      db.payment.count({ where: { tenantId: t.id, status: { in: ["initiated", "pending_review"] }, invoice: { kind: { in: ["plan", "addon"] } } } }),
      db.invoice.count({ where: { tenantId: t.id, kind: "subscription", status: "paid" } }),
      db.subscription.count({ where: { tenantId: t.id, migrationRunId: null } }),
      db.entitlementGrant.count({ where: { tenantId: t.id, kind: "app", source: "staff", revokedAt: null, endsAt: { gt: now } } }),
    ]);
    const shadowSince = mode === "plans" ? null : (changes.find((c) => (c.target ?? "").endsWith("-> shadow"))?.createdAt ?? null);
    let lessReports = 0, reports = 0;
    if (shadowSince) {
      const diffs = await db.auditLog.findMany({ where: { tenantId: t.id, action: "billing.shadow_diff", createdAt: { gte: shadowSince } }, select: { target: true }, take: 5000 });
      reports = diffs.length;
      lessReports = diffs.filter((d) => !/^0 less\b/.test(d.target ?? "")).length;
    }
    const lessNow = migrated ? (await compareNow(db, t.id, now)).filter((d) => d.kind === "less").map((d) => `${d.what} (${String(d.v1)} -> ${String(d.v3)})`) : [];
    out.push({
      id: t.id, masked: maskName(t.name, t.id), mode, status: t.status, migrated: migrated > 0, gifted: gifts > 0, shadowSince, lessReports, reports, lessNow,
      openInvoices: open.map((i) => i.id), paymentsInFlight, sold: paidNew + ownSubs > 0,
    });
  }
  return out;
}

export interface MoveRules { now: Date; minShadowDays: number; force?: boolean }

/** May this business move to `to`? null = yes; "same" = it is already there; otherwise the reason it may not. */
export function checkMove(row: ModeRow, to: BillingMode, rules: MoveRules): string | null {
  if (row.mode === to) return "same";
  if (to === "plans") {
    if (row.mode === "apps" && row.sold) return "it bought or installed something on the new system, so it stays on apps (switch sales off and fix forward)";
    return null;
  }
  if (!row.migrated && !row.gifted) return "the migration has not written its app rows (run npm run billing:migrate first; a skipped business stays on plans)";
  if (to === "shadow") return row.mode === "apps" ? "it is on apps: go back to plans first" : null;
  // to apps
  if (row.paymentsInFlight) return "a plan payment is in flight: wait until it is paid or fails";
  if (rules.force) return null;
  if (row.mode !== "shadow" || !row.shadowSince) return "it must be on shadow first";
  if (row.lessNow.length) return `the app answer gives less than the plan today: ${row.lessNow.join("; ")}`;
  if (row.lessReports) return `${row.lessReports} recorded difference(s) where the app answer gave less than the plan since it moved to shadow`;
  const days = Math.floor((rules.now.getTime() - row.shadowSince.getTime()) / DAY);
  if (days < rules.minShadowDays) return `on shadow for ${days} day(s); it needs ${rules.minShadowDays}`;
  return null;
}

export interface MoveResult { id: string; masked: string; from: BillingMode; to: BillingMode; ok: boolean; changed: boolean; reason?: string; voided: string[] }

/**
 * Moves the named businesses (or, with `all`, every business the migration wrote) to `to`. Without `apply` it only says what would happen.
 * One transaction per business; a refused business is listed and not written.
 */
export async function setMode(db: Db, o: { to: BillingMode; only?: string[]; all?: boolean; apply?: boolean; minShadowDays?: number; force?: boolean; by?: string; now?: Date }): Promise<MoveResult[]> {
  if (!o.all && !o.only?.length) throw new Error("Name the businesses (only) or say all.");
  const now = o.now ?? new Date();
  const rules: MoveRules = { now, minShadowDays: o.minShadowDays ?? 7, force: o.force };
  let rows = await modeStatus(db, { only: o.all ? undefined : o.only, now });
  // "all" means every business that can be on the new system; going back to plans, every business that left it.
  if (o.all) rows = rows.filter((r) => (o.to === "plans" ? r.mode !== "plans" : r.migrated));
  const out: MoveResult[] = [];
  for (const id of o.all ? [] : o.only ?? []) {
    if (!rows.some((r) => r.id === id)) out.push({ id, masked: `?? (${id})`, from: "plans", to: o.to, ok: false, changed: false, reason: "no such business", voided: [] });
  }
  for (const row of rows) {
    const res: MoveResult = { id: row.id, masked: row.masked, from: row.mode, to: o.to, ok: true, changed: false, voided: o.to === "apps" ? row.openInvoices : [] };
    const why = checkMove(row, o.to, rules);
    if (why === "same") { res.voided = []; res.reason = `already on ${o.to}`; out.push(res); continue; }
    if (why) { res.ok = false; res.voided = []; res.reason = why; out.push(res); continue; }
    if (o.apply) {
      try {
        res.voided = await db.$transaction(async (tx) => {
          // Checked again inside the transaction: the mode and a payment that arrived since the list was read.
          const t = await tx.tenant.findUniqueOrThrow({ where: { id: row.id }, select: { billingMode: true } });
          if (modeOf(t.billingMode) !== row.mode) throw new Error("its mode changed meanwhile");
          let voided: string[] = [];
          if (o.to === "apps") {
            const busy = await tx.payment.count({ where: { tenantId: row.id, status: { in: ["initiated", "pending_review"] }, invoice: { kind: { in: ["plan", "addon"] } } } });
            if (busy) throw new Error("a plan payment is in flight: wait until it is paid or fails");
            const open = await tx.invoice.findMany({ where: { tenantId: row.id, status: "open", kind: { in: ["plan", "addon"] } }, select: { id: true } });
            voided = open.map((i) => i.id);
            if (voided.length) await tx.invoice.updateMany({ where: { id: { in: voided }, status: "open" }, data: { status: "void" } });
          }
          await tx.tenant.update({ where: { id: row.id }, data: { billingMode: o.to } });
          await tx.auditLog.create({ data: {
            actorId: null, tenantId: row.id, action: MODE_CHANGED, target: `${row.mode} -> ${o.to}`, createdAt: now,
            meta: { from: row.mode, to: o.to, by: o.by ?? "script", forced: !!o.force, voidedInvoices: voided } as Prisma.InputJsonValue,
          } });
          return voided;
        }, { timeout: 60_000, maxWait: 20_000 });
        res.changed = true;
      } catch (e) {
        res.ok = false; res.voided = []; res.reason = (e as Error).message;
      }
    }
    out.push(res);
  }
  return out;
}
