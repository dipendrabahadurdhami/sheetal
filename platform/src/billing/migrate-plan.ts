// The plan-to-apps move of ONE business, worked out on paper first (MARKETPLACE-AND-BILLING.md section 8, rules R1 to R11, proofs P1 to P8).
// Where it fits: backend-core/src/domain/billing-migration.ts loads each business, calls planMigration(), prints it (dry run) or writes
// exactly these rows in one transaction (apply). The script backend-core/scripts/migrate-plans-to-apps.ts is the command line around it.
// How it works: pure. In: the business as it is today (plan, limits with add-ons, add-ons, dates, status, usage counts, open invoices,
// payments in flight, monthly AI credits) plus the catalog and billing settings. Out: either "skip" with the reason (R8, R10, P8), or the
// rows to write (subscriptions, grants, add-on records, price lock, AI credits) and the proofs, each PASS or FAIL with what it saw:
//   P1 access  the same comparison shadow mode uses (compareEntitlements, v1 = buildEntitlements, v3 = buildEntitlementsV3 from these very
//              rows), at now, just before the paid (or trial) period ends, and just before an old grace ends; plus AI credits per month.
//   P2 usage   every counted limit of every app the business gets is at least what it uses today (ALLOWED_OVER lists exceptions).
//   P3 price   the first renewal, built by the real quote() with the price lock, costs no more than the old renewal (plan + add-ons).
//   P4 dates   period end = renewsAt, the status as R8 says, graceUntil copied.
//   P7 same    planning the same business twice gives exactly the same rows (the runner adds: a migrated business is never written twice).
//   P8 unknown an unknown plan, type, app edition or add-on is listed and the business skipped, never guessed.
// P5 (row counts) and P6 (paid invoices) need the database: the runner checks them inside the transaction.
// Decisions (written in CHANGES-P3-BE-10.md): limits come from the plan WITH its add-ons (what v1 enforces today) as grants until lockEnd, so
// nothing drops when an add-on period ends; the add-on rows are kept as records with the old price (appId "legacy", never counted twice);
// R10 open invoices are listed, not voided, while the business stays on billingMode "plans" (the switch to "apps" voids them, OPS-1).
// Rules: never lowers anything; same input = same output (ids are made by the runner, not here).

import type { AppManifest } from "../core/manifest.js";
import { buildEntitlements } from "../tenancy/context.js";
import { APPS } from "../tenancy/apps.generated.js";
import { buildEntitlementsV3, type GrantState } from "./entitlements.js";
import { mapPlanToApps, newKeyOf, type OldPlan } from "./mapping.js";
import { quote } from "./quote.js";
import { compareEntitlements, type ShadowDiff } from "./shadow.js";
import { addNepalDays } from "./days.js";
import type { BillingSettings, Catalog, SubscriptionState, SubscriptionStatus } from "./types.js";

/** Businesses allowed to be over a new limit on day one (P2), by id. Empty: R3 grants make sure nobody is. */
export const ALLOWED_OVER: readonly string[] = [];

export const KNOWN_TYPES = ["hotel", "host", "developer", "agency", "sponsor"] as const;
const SKIP_STATUS = new Set(["suspended", "cancelled", "pending_verification"]);

export interface MigrationBusiness {
  id: string;
  name: string;
  type: string;
  status: string; // TenantStatus: trial, active, past_due, suspended, cancelled, pending_verification
  demo: boolean;
  period: number;
  renewsAt: Date | null;
  graceUntil: Date | null;
  coveredById: string | null;
  plan: { id: string; name: string; price: number; limits: Record<string, number>; features: Record<string, boolean> } | null;
  /** The plan's limits raised by bought add-ons (domain/addons.ts effectiveLimits): what v1 enforces today. */
  limits: Record<string, number>;
  /** Bought add-ons with the price a month per unit today (whole rupees, VAT included). */
  addons: { id: string; qty: number; renewQty: number; priceMonth: number | null }[];
  /** The old renewal for one paid period (plan with its multi-month discount + add-ons kept), in whole rupees. */
  oldRenewalRupees: number;
  /** Today's usage by "appId.key" (only the limits the runner can count). */
  usage: Record<string, number>;
  /** Monthly AI credits of the plan today (domain/ai-features). */
  aiCreditsMonthly: number;
  /** Open plan or add-on invoices (R10) and payments still in flight. */
  openInvoices: { id: string; kind: string }[];
  paymentsInFlight: number;
  /** For a covered business: the paying business's renewal date (its lock ends 12 months after it). */
  parentRenewsAt?: Date | null;
}

export interface PlannedSubscription {
  appId: string; editionId: string; status: SubscriptionStatus; periodMonths: number | null; priceGrossPaisa: number; listPriceGrossPaisa: number;
  currentPeriodStart: Date | null; currentPeriodEnd: Date | null; trialEndsAt: Date | null; trialUsedAt: Date | null; graceUntil: Date | null;
  source: "migration" | "covered";
}
export interface PlannedGrant { kind: "app" | "limit" | "seats" | "ai_credits_monthly"; appId: string | null; key: string | null; value: number | null; source: "migration" | "covered"; reason: string; startsAt: Date; endsAt: Date }
export interface PlannedAddon { appId: "legacy"; addonKey: string; qty: number; renewQty: number; unitPriceGrossPaisa: number; periodMonths: number; currentPeriodEnd: Date }
export interface PlannedLock { legacyMonthlyGrossPaisa: number; legacyPeriodMonths: number; coversApps: string[]; lockEnd: Date }

export interface Proof { id: "P1" | "P2" | "P3" | "P4" | "P7" | "P8"; ok: boolean; detail: string }

export interface PriceRow { oldMonthlyPaisa: number; protectedRenewalPaisa: number; afterLockRenewalPaisa: number; usedOnlyRenewalPaisa: number; periodMonths: number }

export type MigrationPlan =
  | { kind: "skip"; id: string; masked: string; reason: string }
  | {
      kind: "write"; id: string; masked: string; lockEnd: Date;
      subscriptions: PlannedSubscription[]; grants: PlannedGrant[]; addons: PlannedAddon[]; lock: PlannedLock | null;
      /** R10: open invoices that the switch to "apps" voids (listed, not touched now). */
      invoicesToVoid: string[];
      proofs: Proof[]; less: ShadowDiff[]; more: ShadowDiff[]; price: PriceRow | null;
    };

/** "Sheetal Realty" -> "Sh… (id)": names never appear in full in a printout. */
export const maskName = (name: string, id: string) => `${[...(name ?? "").trim()].slice(0, 2).join("") || "??"}… (${id})`;

const addMonths = (d: Date, n: number) => { const x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const minusMs = (d: Date) => new Date(d.getTime() - 1);

export interface PlanInput {
  b: MigrationBusiness;
  now: Date;
  catalog: Catalog;
  settings: BillingSettings;
  manifests: readonly Pick<AppManifest, "id" | "kind" | "businessTypes">[];
  /** App ids the business used in the last 90 days (for the price report's "kept only what it used"); null = not known. */
  usedApps?: readonly string[] | null;
}

export function planMigration(input: PlanInput): MigrationPlan {
  const { b, now, catalog, settings } = input;
  const masked = maskName(b.name, b.id);
  const skip = (reason: string): MigrationPlan => ({ kind: "skip", id: b.id, masked, reason });

  // R8 and P8: what is never guessed.
  if (b.demo) return skip("demo business (R8)");
  if (SKIP_STATUS.has(b.status)) return skip(`status ${b.status} (R8: mapped when staff reactivate it)`);
  if (!["active", "trial", "past_due"].includes(b.status)) return skip(`P8: unknown status ${b.status}`);
  if (!(KNOWN_TYPES as readonly string[]).includes(b.type)) return skip(`P8: unknown business type ${b.type}`);
  if (!b.plan || !["Starter", "Business", "Pro"].includes(b.plan.name)) return skip(`P8: unknown plan ${b.plan?.id ?? "(none)"}`);
  const unknownAddon = b.addons.find((a) => a.qty > 0 && a.priceMonth == null);
  if (unknownAddon) return skip(`P8: unknown add-on ${unknownAddon.id}`);
  // R10: a payment in flight settles first.
  if (b.paymentsInFlight > 0) return skip("a plan payment is in flight (R10: run again when it settles)");

  const covered = !!b.coveredById;
  const paid = b.plan.price > 0 && !covered;
  const trial = b.status === "trial";
  const months = [1, 3, 6, 12].includes(b.period) ? b.period : 0;
  if (paid && !trial && (!b.renewsAt || !months)) return skip(`P4: a paid plan without a renewal date or with period ${b.period}`);
  if (trial && !b.renewsAt) return skip("P4: a trial without an end date");
  if (covered && !b.parentRenewsAt) return skip("R9: the paying business has no renewal date (migrate it first)");

  // Lock end (R8): paid = renewsAt + lock months; covered = the paying business's lock; free and trial = the free-limit days.
  const freeEnd = addNepalDays(now, settings.migrationFreeLimitDays);
  const lockEnd = covered ? addMonths(b.parentRenewsAt!, settings.migrationLockMonths)
    : paid && !trial ? addMonths(b.renewsAt!, settings.migrationLockMonths)
    : trial && b.renewsAt! > freeEnd ? b.renewsAt! : freeEnd;

  const oldPlan: OldPlan = { price: b.plan.price, limits: b.limits, features: b.plan.features ?? {} };
  const mapped = mapPlanToApps({ type: b.type, plan: oldPlan, manifests: input.manifests, catalog });
  // MB 8.2: the paid plans' mailboxes (1 GB) become the Mail app.
  if ((paid || covered) && catalog.apps.mail?.editions.full && !mapped.subscriptions.some((s) => s.appId === "mail")) mapped.subscriptions.push({ appId: "mail", editionId: "full" });

  for (const s of mapped.subscriptions) if (!catalog.apps[s.appId]?.editions[s.editionId]) return skip(`P8: the catalog has no ${s.appId} edition ${s.editionId}`);

  const reason = `Moved from the ${b.plan.name} plan`;
  const source = covered ? "covered" as const : "migration" as const;
  const grants: PlannedGrant[] = [];
  const subscriptions: PlannedSubscription[] = [];
  const priceFor = (appId: string, ed: string, m: number) => {
    const e = catalog.apps[appId]!.editions[ed]!;
    return m === 12 ? e.priceYearPaisa : e.priceMonthPaisa * m;
  };
  const periodEnd = b.renewsAt;
  for (const s of mapped.subscriptions) {
    const full = s.editionId !== "free";
    if (covered && full) {
      // R9: a covered business pays nothing itself: the app on its free edition (or locked) plus a whole-app grant until the parent's lock ends.
      const hasFree = !!catalog.apps[s.appId]!.editions.free;
      subscriptions.push(row(s.appId, hasFree ? "free" : s.editionId, hasFree ? "active" : "expired", null, 0, null, null, null, null, null, source));
      grants.push({ kind: "app", appId: s.appId, key: s.editionId, value: null, source, reason: `${reason} (covered by another business)`, startsAt: now, endsAt: lockEnd });
    } else if (full && trial) {
      subscriptions.push(row(s.appId, s.editionId, "trialing", null, 0, null, null, periodEnd, now, null, source));
    } else if (full) {
      const p = priceFor(s.appId, s.editionId, months);
      const start = addMonths(periodEnd!, -months);
      const pastDue = b.status === "past_due";
      subscriptions.push(row(s.appId, s.editionId, pastDue ? "past_due" : "active", months, p, start, periodEnd, null, null, pastDue ? b.graceUntil : null, source));
      // An old grace longer than the new one: the paid edition stays whole until the old grace ends (P1 at that moment).
      if (pastDue && b.graceUntil && b.graceUntil > addNepalDays(periodEnd!, settings.graceDays)) {
        grants.push({ kind: "app", appId: s.appId, key: s.editionId, value: null, source, reason: `${reason} (the old grace period)`, startsAt: now, endsAt: b.graceUntil });
      }
    } else {
      subscriptions.push(row(s.appId, "free", "active", null, 0, null, null, null, null, null, source));
    }
  }
  function row(appId: string, editionId: string, status: SubscriptionStatus, periodMonths: number | null, price: number, start: Date | null, end: Date | null, trialEndsAt: Date | null, trialUsedAt: Date | null, graceUntil: Date | null, src: PlannedSubscription["source"]): PlannedSubscription {
    return { appId, editionId, status, periodMonths, priceGrossPaisa: price, listPriceGrossPaisa: price, currentPeriodStart: start, currentPeriodEnd: end, trialEndsAt, trialUsedAt, graceUntil, source: src };
  }

  // R3, R4: limit and seat grants from the mapping (old limits the new edition doesn't cover), until lockEnd.
  for (const g of mapped.grants) grants.push({ kind: g.kind, appId: g.appId, key: g.key, value: g.value, source, reason, startsAt: now, endsAt: lockEnd });
  // R3 usage: a limit that was never enforced (or is lower now) but is already passed today gets "unlimited" until lockEnd.
  const v3Of = (at: Date) => buildEntitlementsV3({
    now: at, catalog, settings, seatsUsed: 1, subscriptions: subscriptions.map(toState), addons: [],
    grants: grants.map((g): GrantState => ({ kind: g.kind, appId: g.appId, key: g.key, value: g.value, startsAt: g.startsAt, endsAt: g.endsAt, revokedAt: null })),
  });
  {
    const v3 = v3Of(now);
    for (const [k, used] of Object.entries(b.usage)) {
      const [appId, key] = k.split(".") as [string, string];
      if (!v3.hasApp(appId)) continue;
      const lim = v3.limit(appId, key);
      if (lim !== null && used > lim) grants.push({ kind: "limit", appId, key, value: null, source, reason: `${reason} (already uses ${used})`, startsAt: now, endsAt: lockEnd });
    }
  }
  // R5: the plan's monthly AI credits, every month until lockEnd. The lifecycle job adds each month's credits from this grant once the
  // business is on "apps" (under "plans" the old credits still apply, so nothing is given twice).
  if (b.aiCreditsMonthly > 0) grants.push({ kind: "ai_credits_monthly", appId: null, key: null, value: b.aiCreditsMonthly, source, reason, startsAt: now, endsAt: lockEnd });

  // R7: add-ons become records with the old price (their capacity is already in the grants above, from the limits WITH add-ons).
  const addons: PlannedAddon[] = paid && periodEnd ? b.addons.filter((a) => a.qty > 0 || a.renewQty > 0).map((a) => ({
    appId: "legacy" as const, addonKey: a.id, qty: a.qty, renewQty: a.renewQty, unitPriceGrossPaisa: (a.priceMonth ?? 0) * 100, periodMonths: months, currentPeriodEnd: periodEnd,
  })) : [];

  // 8.3: the price lock for a paying business. The monthly figure is the old renewal ÷ months (rounded down), so L = monthly × months is
  // never above what the old plan charged, its multi-month discount included.
  const paidApps = subscriptions.filter((s) => s.periodMonths != null).map((s) => s.appId);
  const lock: PlannedLock | null = paid && !trial && months ? {
    legacyMonthlyGrossPaisa: Math.floor((b.oldRenewalRupees * 100) / months), legacyPeriodMonths: months, coversApps: paidApps, lockEnd,
  } : null;

  // ───────────── the proofs ─────────────
  const proofs: Proof[] = [];
  const v1 = buildEntitlements({ type: b.type, plan: { features: b.plan.features ?? {} }, limits: b.limits, seatsUsed: 1 });
  // Compared over the real registry (the one v1 reads), never over the manifests the mapping was given.
  const appIds = APPS.filter((m) => m.kind === "app").map((m) => m.id);
  const at = [now];
  // The end of the period matters only where a period was paid for or is a trial. A free plan can carry a leftover renewsAt (from an
  // earlier paid period): under plans that date decides nothing, so its promise is the lock end below (Q2: today's limits for 90 days).
  if (periodEnd && periodEnd > now && (paid || trial)) at.push(minusMs(periodEnd));
  if (b.status === "past_due" && b.graceUntil && b.graceUntil > now) at.push(minusMs(b.graceUntil));
  // A free or covered business keeps today's answer until its lock ends (a paid or trial one: v1 itself changes after its period).
  if (lockEnd > now && !paid) at.push(minusMs(lockEnd));
  const less: ShadowDiff[] = [];
  let more: ShadowDiff[] = [];
  for (const t of at) {
    const v3 = v3Of(t);
    const d = compareEntitlements({ type: b.type, appIds, oldLimits: b.limits, oldFeatures: b.plan.features ?? {}, v1, v3 });
    for (const x of d.filter((y) => y.kind === "less")) less.push({ ...x, what: `${x.what} (at ${t.toISOString()})` });
    if (t === now) more = d.filter((y) => y.kind === "more");
  }
  const aiGrant = grants.find((g) => g.kind === "ai_credits_monthly")?.value ?? 0;
  if (aiGrant < b.aiCreditsMonthly) less.push({ kind: "less", what: "AI credits a month", v1: b.aiCreditsMonthly, v3: aiGrant });
  proofs.push({ id: "P1", ok: less.length === 0, detail: less.length ? `${less.length} less: ${less.map((x) => x.what).join("; ")}` : `nothing less (${more.length} more)` });

  const v3now = v3Of(now);
  const over = Object.entries(b.usage).filter(([k, used]) => {
    const [appId, key] = k.split(".") as [string, string];
    if (!v3now.hasApp(appId)) return false;
    const lim = v3now.limit(appId, key);
    return lim !== null && used > lim;
  });
  const allowedOver = ALLOWED_OVER.includes(b.id);
  proofs.push({ id: "P2", ok: over.length === 0 || allowedOver, detail: over.length ? `over: ${over.map(([k, u]) => `${k} uses ${u}`).join(", ")}${allowedOver ? " (ALLOWED_OVER)" : ""}` : `${Object.keys(b.usage).length} counted limits within` });

  let price: PriceRow | null = null;
  if (lock && periodEnd) {
    const subsState = subscriptions.map(toState);
    const renewNow = periodEnd > now ? minusMs(periodEnd) : now;
    const q = (withLock: boolean, keep: readonly string[]) => quote({
      now: renewNow, catalog, settings: { ...settings, salesEnabled: true },
      business: { anchorDay: null, subscriptions: subsState, lock: withLock ? { ...lock, lockEnd: lock.lockEnd } : null },
      items: paidApps.filter((a) => keep.includes(a)).map((appId) => ({ kind: "renew" as const, appId })),
    });
    const withLock = q(true, paidApps);
    const old = b.oldRenewalRupees * 100;
    const ok = !withLock.errors.length && withLock.totalPaisa <= old;
    proofs.push({ id: "P3", ok, detail: withLock.errors.length ? `the quote refused: ${withLock.errors.map((e) => e.en).join("; ")}` : `first renewal ${withLock.totalPaisa} ≤ old ${old} paisa` });
    const after = q(false, paidApps);
    const used = input.usedApps ? paidApps.filter((a) => input.usedApps!.includes(a)) : paidApps;
    const usedOnly = used.length ? q(false, used) : null;
    price = { oldMonthlyPaisa: Math.round(old / months), protectedRenewalPaisa: withLock.totalPaisa, afterLockRenewalPaisa: after.totalPaisa, usedOnlyRenewalPaisa: usedOnly?.totalPaisa ?? 0, periodMonths: months };
  } else proofs.push({ id: "P3", ok: true, detail: paid ? "no renewal to price" : "pays nothing today" });

  const dateProblems: string[] = [];
  for (const s of subscriptions) {
    if (s.periodMonths != null && s.currentPeriodEnd?.getTime() !== b.renewsAt?.getTime()) dateProblems.push(`${s.appId} period end`);
    if (s.periodMonths != null && s.periodMonths !== b.period) dateProblems.push(`${s.appId} months`);
    const want = b.status === "past_due" ? "past_due" : "active";
    if (s.periodMonths != null && s.status !== want) dateProblems.push(`${s.appId} status ${s.status}`);
    if (s.status === "trialing" && s.trialEndsAt?.getTime() !== b.renewsAt?.getTime()) dateProblems.push(`${s.appId} trial end`);
    if (s.status === "past_due" && s.graceUntil?.getTime() !== b.graceUntil?.getTime()) dateProblems.push(`${s.appId} grace`);
  }
  proofs.push({ id: "P4", ok: dateProblems.length === 0, detail: dateProblems.length ? dateProblems.join(", ") : `${subscriptions.length} subscriptions, dates as R8` });

  const invoicesToVoid = b.openInvoices.filter((i) => i.kind === "plan" || i.kind === "addon").map((i) => i.id);
  proofs.push({ id: "P8", ok: true, detail: "plan, type, editions and add-ons all known" });

  const out = { kind: "write" as const, id: b.id, masked, lockEnd, subscriptions, grants, addons, lock, invoicesToVoid, proofs, less, more, price };
  return out;
}

/** P7: the same business planned twice gives the same rows. */
export function planIsStable(input: PlanInput): Proof {
  const a = JSON.stringify(planMigration(input));
  const b = JSON.stringify(planMigration(input));
  return { id: "P7", ok: a === b, detail: a === b ? "the same rows twice" : "two runs differ" };
}

const toState = (s: PlannedSubscription): SubscriptionState => ({
  appId: s.appId, editionId: s.editionId, status: s.status, periodMonths: s.periodMonths, priceGrossPaisa: s.priceGrossPaisa,
  currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd, trialEndsAt: s.trialEndsAt, trialUsedAt: s.trialUsedAt,
  cancelAtPeriodEnd: false, uninstalledAt: null,
});

/** planMigration plus P7 (planned twice, the same rows). */
export function plan(input: PlanInput): MigrationPlan {
  const p = planMigration(input);
  if (p.kind === "skip") return p;
  p.proofs.splice(p.proofs.length - 1, 0, planIsStable(input));
  return p;
}

/** Every proof passed. */
export const passed = (p: MigrationPlan) => p.kind === "write" && p.proofs.every((x) => x.ok);

/** Old limit keys the mapping could not place (listed in the dry run). */
export const unplacedKeys = (type: string, limits: Record<string, number>) => Object.keys(limits).filter((k) => k !== "seats" && !newKeyOf(type, k));
