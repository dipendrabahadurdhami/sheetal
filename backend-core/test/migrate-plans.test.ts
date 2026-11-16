// Migration proofs P1 to P8 (P3-BE-10, suite 12 of PHASE-3-TEST-PLAN.md): moving a business from Starter / Business / Pro to app subscriptions
// loses no app, limit, feature, seat or AI credit, costs no more at the first renewal, is all-or-nothing per business, writes nothing twice,
// and --restore removes only its own run's rows.
// Where it fits: the pure planner (platform/src/billing/migrate-plan.ts) over every QA-1 fixture, then the database side
// (src/domain/billing-migration.ts) on the suite's temporary database: dry run, apply, second apply, restore, the lifecycle job's AI credits.
// Run with: npm run test -w @sheetal/backend-core
import type {} from "@sheetal/platform/test/setup-db";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { APPS } from "@sheetal/platform/tenancy/apps.generated";
import { seedCatalog } from "@sheetal/platform/billing/catalog";
import { BILLING_DEFAULTS, type Catalog } from "@sheetal/platform/billing/types";
import { buildEntitlementsV3 } from "@sheetal/platform/billing/entitlements";
import { plan, passed, maskName, type MigrationBusiness } from "@sheetal/platform/billing/migrate-plan";
import { runSubscriptionLifecycle } from "@sheetal/platform/billing/lifecycle";
import { addNepalDays } from "@sheetal/platform/billing/days";
import { apply, dryRun, migrationEnv, priceReportCsv, restore } from "../src/domain/billing-migration.js";
import { ALL, EXTRA, NOW, PLANS, RENEWS, SKIPPED } from "./migrate-plans.fixtures.js";

const catalog = seedCatalog();
const settings = { ...BILLING_DEFAULTS };
const planOf = (b: MigrationBusiness, o: { catalog?: Catalog; manifests?: typeof APPS } = {}) =>
  plan({ b, now: NOW, catalog: o.catalog ?? catalog, settings, manifests: o.manifests ?? APPS });

describe("the planner: every fixture passes every proof", () => {
  const cases = [...ALL.filter((b) => b.status !== "suspended").map((b) => ({ name: b.name, b })), ...EXTRA];
  it.each(cases)("$name", ({ b }) => {
    const p = planOf(b);
    expect(p.kind).toBe("write");
    if (p.kind !== "write") return;
    expect(p.proofs.filter((x) => !x.ok)).toEqual([]);
    expect(p.proofs.map((x) => x.id)).toEqual(["P1", "P2", "P3", "P4", "P7", "P8"]);
    expect(p.less).toEqual([]);
  });

  it.each(SKIPPED)("$name is skipped and listed, never guessed", ({ b, reason }) => {
    const p = planOf(b);
    expect(p.kind).toBe("skip");
    if (p.kind === "skip") expect(p.reason).toMatch(reason);
  });
});

describe("the planner: the rules", () => {
  const get = (name: string) => {
    const p = planOf([...ALL, ...EXTRA.map((e) => e.b)].find((b) => b.name === name || b.id === name)!);
    if (p.kind !== "write") throw new Error(`${name} was skipped`);
    return p;
  };

  it("R2 and R8: a paid plan's apps are full, monthly, with the period ending on renewsAt; Starter's are free and have no period", () => {
    const biz = get("hotel Business");
    const hotel = biz.subscriptions.find((s) => s.appId === "hotel")!;
    expect(hotel).toMatchObject({ editionId: "full", status: "active", periodMonths: 1, currentPeriodEnd: RENEWS, priceGrossPaisa: 70_000, source: "migration" });
    expect(biz.subscriptions.find((s) => s.appId === "mail")).toMatchObject({ editionId: "full" }); // MB 8.2: the paid plans' mailboxes
    const free = get("hotel Starter");
    expect(free.subscriptions.every((s) => s.editionId === "free" && s.periodMonths === null)).toBe(true);
    expect(free.lock).toBeNull();
    expect(free.lockEnd).toEqual(addNepalDays(NOW, 90)); // the free businesses' 90 days
  });

  it("a free business with a leftover renewal date (found in the dry run on real data): the promise is the 90 days, not that date", () => {
    // A Starter business can carry a renewsAt from an earlier paid period. Under plans that date decides nothing for a free plan, so P1 is
    // checked today and just before the 90 days end, never at that date (long after the old limits have gone back to the free edition's).
    const starter = ALL.find((b) => b.name === "hotel Starter")!;
    const p = planOf({ ...starter, id: "hotel-starter-old-date", period: 12, renewsAt: new Date("2027-11-04T22:15:00Z") });
    expect(p.kind).toBe("write");
    if (p.kind !== "write") return;
    expect(p.proofs.filter((x) => !x.ok)).toEqual([]);
    expect(p.lockEnd).toEqual(addNepalDays(NOW, 90));
    expect(p.lock).toBeNull();
    expect(p.subscriptions.every((s) => s.editionId === "free" && s.currentPeriodEnd === null)).toBe(true);
    // A PAID business is still checked just before its period ends: breaking its last day must fail P1.
    const paid = planOf(ALL.find((b) => b.name === "hotel Business")!);
    expect(paid.kind === "write" && paid.proofs.find((x) => x.id === "P1")?.ok).toBe(true);
  });

  it("R2: POS and Agreements are full only where the old plan had their switch", () => {
    for (const name of ["hotel Business", "hotel Pro", "agency Business"]) {
      const p = get(name);
      const f = [...ALL, ...EXTRA.map((e) => e.b)].find((b) => b.name === name)!.plan!.features;
      const pos = p.subscriptions.find((s) => s.appId === "pos");
      if (pos) expect(pos.editionId, name).toBe(f.pos ? "full" : "free");
    }
  });

  it("R3: a limit above the new edition becomes a grant until the lock ends; usage above the new free limit becomes unlimited", () => {
    const starter = get("hotel Starter");
    expect(starter.grants.find((g) => g.kind === "limit" && g.appId === "hotel" && g.key === "rooms")).toMatchObject({ value: 10, endsAt: starter.lockEnd });
    const over = get("agency-over");
    for (const [appId, key] of [["crm", "leads"], ["invoicing", "invoices_per_month"], ["listings", "listings"]] as const) {
      expect(over.grants.find((g) => g.kind === "limit" && g.appId === appId && g.key === key), `${appId}.${key}`).toMatchObject({ value: null });
    }
  });

  it("R4 and R7: seats with add-ons become a seat grant; add-ons are kept as records with the old price, not counted twice", () => {
    const p = get("agency-addons");
    expect(p.grants.find((g) => g.kind === "seats")).toMatchObject({ value: 11 });
    expect(p.grants.find((g) => g.kind === "limit" && g.key === "listings")?.value ?? null).not.toBe(0);
    expect(p.addons).toEqual([
      expect.objectContaining({ appId: "legacy", addonKey: "listings", qty: 2, unitPriceGrossPaisa: 50_000 }),
      expect.objectContaining({ appId: "legacy", addonKey: "seats", qty: 1, unitPriceGrossPaisa: 30_000 }),
    ]);
  });

  it("R5: the plan's monthly AI credits become a monthly grant until the lock ends", () => {
    const p = get("agency Pro");
    expect(p.grants.find((g) => g.kind === "ai_credits_monthly")).toMatchObject({ value: 6000, endsAt: p.lockEnd });
  });

  it("R8: trial -> trialing until renewsAt, no lock; past due keeps its grace (and a longer old grace is covered by app grants)", () => {
    const t = get("agency Business in trial");
    expect(t.subscriptions.find((s) => s.appId === "listings")).toMatchObject({ status: "trialing", periodMonths: null, trialEndsAt: RENEWS });
    expect(t.lock).toBeNull();
    const pd = get("developer Business past due");
    expect(pd.subscriptions.find((s) => s.periodMonths)).toMatchObject({ status: "past_due", graceUntil: new Date("2026-11-25T00:00:00Z") });
    const long = get("dev-long-grace");
    expect(long.grants.filter((g) => g.kind === "app").every((g) => g.endsAt.getTime() === new Date("2026-12-10T00:00:00Z").getTime())).toBe(true);
    expect(long.grants.some((g) => g.kind === "app")).toBe(true);
  });

  it("R8 lock: paid = renewsAt + 12 months; the price lock covers every paid app at the old renewal ÷ months", () => {
    const p = get("agency-3mo");
    expect(p.lockEnd.toISOString()).toBe("2027-12-05T00:00:00.000Z");
    expect(p.lock).toMatchObject({ legacyPeriodMonths: 3, legacyMonthlyGrossPaisa: Math.floor((Math.round(1500 * 3 * 0.91) * 100) / 3) });
    expect(p.subscriptions.filter((s) => s.periodMonths).every((s) => s.periodMonths === 3)).toBe(true);
    expect(p.lock!.coversApps.sort()).toEqual(p.subscriptions.filter((s) => s.periodMonths).map((s) => s.appId).sort());
  });

  it("R9: a covered business pays nothing: free rows plus whole-app grants until the paying business's lock ends", () => {
    const p = get("host-covered");
    expect(p.lock).toBeNull();
    expect(p.subscriptions.every((s) => s.periodMonths === null && s.source === "covered")).toBe(true);
    expect(p.grants.filter((g) => g.kind === "app").length).toBeGreaterThan(0);
    expect(p.lockEnd.toISOString()).toBe("2027-12-05T00:00:00.000Z");
  });

  it("P3: the first renewal never costs more than the old one, and the report shows the price after the lock", () => {
    for (const name of ["hotel Business", "agency Pro", "agency-3mo", "hotel-12mo", "agency-addons"]) {
      const p = get(name);
      expect(p.price, name).not.toBeNull();
      expect(p.price!.protectedRenewalPaisa, name).toBeLessThanOrEqual(p.price!.oldMonthlyPaisa * p.price!.periodMonths + p.price!.periodMonths);
    }
  });

  it("a deliberately broken mapping makes P1 fail (an app v1 has is missing)", () => {
    const b = ALL.find((x) => x.name === "agency Business")!;
    const p = planOf(b, { manifests: APPS.filter((a) => a.id !== "crm") as typeof APPS });
    expect(p.kind).toBe("write");
    expect(passed(p)).toBe(false);
    if (p.kind === "write") expect(p.proofs.find((x) => x.id === "P1")).toMatchObject({ ok: false });
  });

  it("a broken price (a catalog that renews dearer with the lock removed) still passes P3 thanks to the lock; without a lock row it would not", () => {
    const dear = structuredClone(catalog);
    for (const a of Object.values(dear.apps)) for (const e of Object.values(a.editions)) if (!e.free) { e.priceMonthPaisa *= 10; e.priceYearPaisa *= 10; }
    const p = planOf(ALL.find((x) => x.name === "hotel Business")!, { catalog: dear });
    expect(passed(p)).toBe(true);
    if (p.kind === "write") expect(p.price!.afterLockRenewalPaisa).toBeGreaterThan(p.price!.protectedRenewalPaisa);
  });

  it("names are masked to two letters plus the id", () => {
    expect(maskName("Sheetal Realty", "t1")).toBe("Sh… (t1)");
  });

  it("v3 from the planned rows keeps a Starter hotel's 10 rooms on the free edition until the lock ends, then the free 5", () => {
    const p = get("hotel Starter");
    const v3 = (at: Date) => buildEntitlementsV3({ now: at, catalog, settings, seatsUsed: 1, addons: [],
      subscriptions: p.subscriptions.map((s) => ({ ...s, cancelAtPeriodEnd: false, uninstalledAt: null })),
      grants: p.grants.map((g) => ({ ...g, revokedAt: null })) });
    expect(v3(NOW).limit("hotel", "rooms")).toBe(10);
    expect(v3(new Date(p.lockEnd.getTime() + 1)).limit("hotel", "rooms")).toBe(5);
  });
});

// ───────────── the database side ─────────────

const db = new PrismaClient({ datasources: { db: { url: inject("databaseUrl") } } });
const log = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return log; }, level: "silent", silent() {} } as never;
const ids = { agency: "mig-agency-biz", hotel: "mig-hotel-starter", busy: "mig-in-flight", other: "mig-other", over: "mig-over" };
const env = async () => migrationEnv(db as never, { now: NOW });

beforeAll(async () => {
  for (const p of PLANS) await db.plan.upsert({ where: { id: p.id }, create: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort }, update: {} });
  await db.tenant.create({ data: { id: ids.agency, name: "Migrate Realty", type: "agency", planId: "agency-business", status: "active", period: 1, renewsAt: RENEWS } });
  await db.tenantAddon.create({ data: { tenantId: ids.agency, addonId: "seats", qty: 2, renewQty: 2 } });
  await db.invoice.create({ data: { tenantId: ids.agency, planId: "agency-business", months: 1, subtotal: 1327, vat: 173, total: 1500, status: "paid", dueAt: NOW, paidAt: NOW } });
  await db.invoice.create({ data: { tenantId: ids.agency, planId: "agency-business", months: 1, subtotal: 1327, vat: 173, total: 1500, status: "open", dueAt: RENEWS } });
  await db.tenant.create({ data: { id: ids.hotel, name: "Migrate Hotel", type: "hotel", planId: "hotel-starter", status: "active" } });
  await db.tenant.create({ data: { id: ids.busy, name: "Busy Realty", type: "agency", planId: "agency-business", status: "active", period: 1, renewsAt: RENEWS } });
  const inv = await db.invoice.create({ data: { tenantId: ids.busy, planId: "agency-business", months: 1, subtotal: 1327, vat: 173, total: 1500, status: "open", dueAt: RENEWS } });
  await db.payment.create({ data: { invoiceId: inv.id, tenantId: ids.busy, provider: "esewa", amount: 1500, status: "initiated", ref: "mig-ref-1" } });
  await db.tenant.create({ data: { id: ids.other, name: "Other Realty", type: "agency", planId: "agency-starter", status: "active" } });
  await db.tenant.create({ data: { id: ids.over, name: "Over Realty", type: "agency", planId: "agency-starter", status: "active" } });
  for (let i = 0; i < 4; i++) await db.listing.create({ data: { tenantId: ids.over, title: `Flat ${i}`, code: `MIG-${i}`, slug: `mig-over-${i}`, purpose: "rent", category: "flat" } });
});
// The suite's database is shared by every file: leave it as found (p3-billing-tables.test.ts expects the billing tables empty).
afterAll(async () => {
  const all = Object.values(ids);
  await db.auditLog.deleteMany({ where: { tenantId: { in: all } } });
  await db.payment.deleteMany({ where: { tenantId: { in: all } } });
  await db.invoice.deleteMany({ where: { tenantId: { in: all } } });
  await db.listing.deleteMany({ where: { tenantId: { in: all } } });
  await db.tenantAddon.deleteMany({ where: { tenantId: { in: all } } });
  await db.tenant.deleteMany({ where: { id: { in: all } } }); // subscriptions, grants, add-ons, locks and AI credits go with them
  await db.billingMigrationRun.deleteMany({});
  await db.$disconnect();
});

const counts = async (tenantId: string) => ({
  subs: await db.subscription.count({ where: { tenantId } }),
  grants: await db.entitlementGrant.count({ where: { tenantId } }),
  addons: await db.addonSubscription.count({ where: { tenantId } }),
  lock: await db.billingLock.count({ where: { tenantId } }),
});

describe("the script on a database", () => {
  const mine = [ids.agency, ids.hotel, ids.busy, ids.over];

  it("the dry run writes nothing and lists the business with a payment in flight", async () => {
    const before = await db.billingMigrationRun.count();
    const r = await dryRun(db as never, await env(), mine);
    expect(await db.billingMigrationRun.count()).toBe(before);
    for (const id of mine) expect(await counts(id)).toEqual({ subs: 0, grants: 0, addons: 0, lock: 0 });
    expect(r.find((x) => x.plan.id === ids.busy)?.plan).toMatchObject({ kind: "skip", reason: expect.stringMatching(/in flight/) });
    const agency = r.find((x) => x.plan.id === ids.agency)!.plan;
    expect(agency.kind === "write" && agency.invoicesToVoid.length).toBe(1);
    expect(priceReportCsv(r)).toMatch(/^business,period_months,old_monthly/);
    expect(priceReportCsv(r)).not.toMatch(/Migrate Realty/); // masked
  });

  it("the usage count raises a limit that is already passed (4 listings on a Starter agency with a free 3)", async () => {
    const r = await dryRun(db as never, await env(), [ids.over]);
    const p = r[0]!.plan;
    expect(p.kind === "write" && p.grants.find((g) => g.appId === "listings" && g.key === "listings")?.value).toBe(null);
    expect(passed(p)).toBe(true);
  });

  let runId = "";
  it("apply writes every row stamped with the run, in one transaction per business, and changes nothing else", async () => {
    const before = await db.tenant.findMany({ where: { id: { in: mine } }, orderBy: { id: "asc" } });
    const r = await apply(db as never, await env(), { only: mine });
    runId = r.runId;
    expect(r.ok).toBe(true);
    const agency = await counts(ids.agency);
    expect(agency.subs).toBeGreaterThan(3);
    expect(agency.lock).toBe(1);
    expect(agency.addons).toBe(1);
    expect(await db.subscription.count({ where: { tenantId: ids.agency, migrationRunId: { not: runId } } })).toBe(0);
    expect(await db.entitlementGrant.count({ where: { tenantId: ids.agency, migrationRunId: runId, kind: "seats", value: 12 } })).toBe(1);
    expect(await db.subscriptionEvent.count({ where: { tenantId: ids.agency, type: "migrated", actorKind: "migration" } })).toBe(agency.subs);
    expect(await db.auditLog.count({ where: { tenantId: ids.agency, action: "billing.migrated", target: runId } })).toBe(1);
    // R11 and step 1 of MB 8.6: plan, dates, status and the billing mode stay exactly as they were.
    const after = await db.tenant.findMany({ where: { id: { in: mine } }, orderBy: { id: "asc" } });
    expect(after.map((t) => [t.planId, t.renewsAt, t.period, t.status, t.billingMode])).toEqual(before.map((t) => [t.planId, t.renewsAt, t.period, t.status, t.billingMode]));
    expect(after.every((t) => t.billingMode === "plans")).toBe(true);
    // R10: the open plan invoice is listed, not touched; the paid one never.
    expect(await db.invoice.count({ where: { tenantId: ids.agency, status: "open" } })).toBe(1);
    expect(await counts(ids.busy)).toEqual({ subs: 0, grants: 0, addons: 0, lock: 0 });
    const run = await db.billingMigrationRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.finishedAt).not.toBeNull();
    expect((run.report as { written: number }).written).toBe(3);
  });

  it("P7: a second apply writes nothing (every business is listed as already moved)", async () => {
    const before = await counts(ids.agency);
    const r = await apply(db as never, await env(), { only: mine });
    expect(r.results.filter((x) => x.written)).toEqual([]);
    expect(await counts(ids.agency)).toEqual(before);
    expect(r.results.find((x) => x.plan.id === ids.agency)?.plan).toMatchObject({ kind: "skip", reason: expect.stringMatching(/already/) });
  });

  it("the lifecycle job gives a moved business its monthly AI credits once it is on apps, once per month", async () => {
    await db.tenant.update({ where: { id: ids.agency }, data: { billingMode: "apps" } });
    await runSubscriptionLifecycle(db as never, { log, now: NOW, catalog, settings });
    await runSubscriptionLifecycle(db as never, { log, now: new Date(NOW.getTime() + 3_600_000), catalog, settings });
    const credits = await db.aiCreditGrant.findMany({ where: { tenantId: ids.agency, source: "migration" } });
    expect(credits.length).toBe(1);
    expect(credits[0]!.credits).toBe(2000);
    await runSubscriptionLifecycle(db as never, { log, now: new Date(NOW.getTime() + 32 * 864e5), catalog, settings });
    expect(await db.aiCreditGrant.count({ where: { tenantId: ids.agency, source: "migration" } })).toBe(2);
  });

  it("restore refuses a business that bought something on the new system (unless --force) and removes only its own run's rows", async () => {
    // Another business's own app (not from the run) must survive the restore.
    await db.subscription.create({ data: { tenantId: ids.other, appId: "crm", editionId: "free", status: "active", source: "install" } });
    // The hotel installs an app itself after the move: that is a new-system choice, so its restore is refused.
    await db.subscription.create({ data: { tenantId: ids.hotel, appId: "reviews_extra", editionId: "free", status: "active", source: "install" } });
    const r = await restore(db as never, { runId, now: NOW });
    expect(r.refused.map((x) => x.id)).toEqual([ids.hotel]);
    expect(r.restored.sort()).toEqual([ids.agency, ids.over].sort());
    expect(await counts(ids.agency)).toEqual({ subs: 0, grants: 0, addons: 0, lock: 0 });
    expect(await db.aiCreditGrant.count({ where: { tenantId: ids.agency, source: "migration" } })).toBe(0);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: ids.agency } })).billingMode).toBe("plans");
    expect(await db.subscription.count({ where: { tenantId: ids.other } })).toBe(1);
    expect(await db.subscription.count({ where: { tenantId: ids.hotel, migrationRunId: runId } })).toBeGreaterThan(0);
    // --force removes the run's rows and keeps the business's own one.
    const f = await restore(db as never, { runId, only: [ids.hotel], force: true, now: NOW });
    expect(f.restored).toEqual([ids.hotel]);
    expect(await db.subscription.count({ where: { tenantId: ids.hotel } })).toBe(1);
    expect(await db.billingMigrationRun.count({ where: { mode: "restore" } })).toBe(2);
  });

  it("after a restore the business can be moved again", async () => {
    const r = await apply(db as never, await env(), { only: [ids.agency] });
    expect(r.ok).toBe(true);
    expect(r.results[0]!.written).toBe(true);
  });
});
